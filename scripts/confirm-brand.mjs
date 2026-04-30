/**
 * scripts/confirm-brand.mjs
 *
 * STAGE 2 brand-onboarding orchestrator. Run after a Stage 1 brand
 * (created by onboard-brand.mjs) has been confirmed by the brand owner
 * and they have provided their Shopify Storefront API token + admin email.
 *
 *   node scripts/confirm-brand.mjs --slug <slug> \
 *        --admin-email <email> \
 *        [--shopify-token <tok>] \
 *        [--shopify-domain <host>] \
 *        [--skip-wallet] [--skip-badge] [--dry-run]
 *
 * What it does:
 *   1. Verifies the brand row exists in rrg_brands.
 *   2. Updates rrg_brands.contact_email and (if provided)
 *      shopify_storefront_token_encrypted + shopify_domain.
 *   3. Spawns scripts/register-brand-agent.mjs --brand <slug> to:
 *        a. generate a fresh EOA owned by the brand
 *        b. fund it from DEPLOYER (~0.00005 ETH)
 *        c. register on ERC-8004 Identity Registry (Base mainnet)
 *        d. update rrg_brands.wallet_address to the new wallet
 *        e. write credentials JSON to tmp/<slug>-credentials-<ts>.json
 *      Skip with --skip-wallet (e.g. re-runs).
 *   4. Spawns scripts/create-membership-listings.mjs --brand <slug> --hidden
 *      to mint a test membership badge that stays hidden=true until you
 *      manually unhide it in /admin/rrg Drops tab. Skip with --skip-badge.
 *   5. Prints a summary with the new wallet, agent ID, badge token ID,
 *      and the manual TG-bot setup instructions (still required because
 *      BRAND_BOTS in lib/rrg/brand-telegram-bot.ts is hardcoded today).
 *
 * What it does NOT do (operator + Claude do these in-session):
 *   - Telegram bot setup. BotFather is manual on Telegram's side. The
 *     summary prompts the user to create the bot and send back the token;
 *     Claude then wires it (env var, BRAND_BOTS edit, setWebhook).
 *   - Notion Onboarding page. Created by Claude in-session from the
 *     "Brand Welcome Guide: Template" against the new brand row. Link is
 *     shared with the user to forward to the brand.
 *   - Encrypt the Shopify token before writing. The column is named
 *     shopify_storefront_token_encrypted but no encryption layer exists in
 *     the repo yet; this script writes the raw token. Treat as the same
 *     trust boundary as SUPABASE_SERVICE_KEY.
 */

import { spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local ──────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch { console.error('FATAL: could not read .env.local'); process.exit(1); }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env.local');
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};

const SLUG          = flag('--slug');
const ADMIN_EMAIL   = flag('--admin-email');
const SHOPIFY_TOKEN = flag('--shopify-token');
const SHOPIFY_DOMAIN = flag('--shopify-domain');
const SKIP_WALLET   = args.includes('--skip-wallet');
const SKIP_BADGE    = args.includes('--skip-badge');
const DRY_RUN       = args.includes('--dry-run');

if (!SLUG || typeof SLUG !== 'string') {
  console.error('Usage: node scripts/confirm-brand.mjs --slug <slug> --admin-email <email> [--shopify-token <tok>] [--shopify-domain <host>] [--skip-wallet] [--skip-badge] [--dry-run]');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function findLatestCredentialsFile(slug) {
  const tmpDir = resolve(process.cwd(), 'tmp');
  try {
    const files = readdirSync(tmpDir)
      .filter(f => f.startsWith(`${slug}-credentials-`) && f.endsWith('.json'))
      .map(f => ({ f, m: statSync(resolve(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0] ? resolve(tmpDir, files[0].f) : null;
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  console.log(`──── Confirm Brand: ${SLUG} ────`);
  console.log(`Dry run:        ${DRY_RUN ? 'YES' : 'no'}`);
  console.log();

  // 1. Verify brand exists
  const { data: brand, error: brandErr } = await db
    .from('rrg_brands')
    .select('id, slug, name, status, wallet_address, contact_email, shopify_domain')
    .eq('slug', SLUG)
    .maybeSingle();
  if (brandErr) { console.error(`FATAL: rrg_brands lookup error: ${brandErr.message}`); process.exit(1); }
  if (!brand) { console.error(`FATAL: brand "${SLUG}" not found in rrg_brands. Run onboard-brand.mjs first.`); process.exit(1); }
  console.log(`[db] found brand id=${brand.id} status=${brand.status}`);
  console.log(`[db] current wallet:  ${brand.wallet_address}`);
  console.log(`[db] current email:   ${brand.contact_email}`);
  console.log(`[db] current shopify: ${brand.shopify_domain ?? '(none)'}`);
  console.log();

  // 2. Apply DB updates (admin email + optional shopify token/domain)
  const updates = {};
  if (ADMIN_EMAIL && typeof ADMIN_EMAIL === 'string') updates.contact_email = ADMIN_EMAIL.toLowerCase();
  if (SHOPIFY_TOKEN && typeof SHOPIFY_TOKEN === 'string') updates.shopify_storefront_token_encrypted = SHOPIFY_TOKEN;
  if (SHOPIFY_DOMAIN && typeof SHOPIFY_DOMAIN === 'string') updates.shopify_domain = SHOPIFY_DOMAIN.toLowerCase();

  if (Object.keys(updates).length > 0) {
    console.log(`[db] applying updates: ${Object.keys(updates).join(', ')}`);
    if (!DRY_RUN) {
      const { error } = await db.from('rrg_brands').update(updates).eq('id', brand.id);
      if (error) { console.error(`FATAL: rrg_brands update failed: ${error.message}`); process.exit(1); }
      console.log(`[db] updated`);
    } else {
      console.log(`[db] DRY: skipped`);
    }
  } else {
    console.log(`[db] no field updates requested (no --admin-email, --shopify-token, or --shopify-domain)`);
  }
  console.log();

  // 3. Wallet + ERC-8004 registration
  let credPath = null;
  if (!SKIP_WALLET) {
    console.log(`──── Spawning register-brand-agent ────`);
    const childArgs = ['scripts/register-brand-agent.mjs', '--brand', SLUG];
    if (DRY_RUN) childArgs.push('--dry-run');
    const result = spawnSync('node', childArgs, { stdio: 'inherit', cwd: process.cwd() });
    if (result.status !== 0) {
      console.error(`FATAL: register-brand-agent exited with code ${result.status}`);
      process.exit(result.status ?? 1);
    }
    credPath = findLatestCredentialsFile(SLUG);
    console.log();
  } else {
    console.log(`[step 3] --skip-wallet: leaving wallet/agent registration alone`);
    console.log();
  }

  // 4. Test membership badge (hidden=true)
  if (!SKIP_BADGE) {
    console.log(`──── Spawning create-membership-listings ────`);
    const childArgs = ['scripts/create-membership-listings.mjs', '--brand', SLUG, '--hidden'];
    if (DRY_RUN) childArgs.push('--dry-run');
    const result = spawnSync('node', childArgs, { stdio: 'inherit', cwd: process.cwd() });
    if (result.status !== 0) {
      console.error(`FATAL: create-membership-listings exited with code ${result.status}`);
      process.exit(result.status ?? 1);
    }
    console.log();
  } else {
    console.log(`[step 4] --skip-badge: leaving membership badge unminted`);
    console.log();
  }

  // 5. Summary
  let creds = null;
  if (credPath) {
    try { creds = JSON.parse(readFileSync(credPath, 'utf8')); }
    catch { /* ignore */ }
  }

  console.log(`──── Stage 2 complete ────`);
  console.log(`Brand:          ${brand.name} (${SLUG})`);
  console.log(`Storefront:     https://realrealgenuine.com/brand/${SLUG}`);
  console.log(`Brand admin:    https://realrealgenuine.com/brand/${SLUG}/admin`);
  if (creds) {
    console.log(`New wallet:     ${creds.wallet_address}`);
    console.log(`Agent ID:       ${creds.erc8004_agent_id ?? '(unknown)'}`);
    console.log(`Credentials:    ${credPath}`);
  }
  console.log();
  console.log(`Operator reminder (show to user):`);
  console.log(`  Create per-brand Telegram bot via @BotFather and send Claude the bot token + username.`);
  console.log();
  console.log(`Claude in-session next:`);
  if (creds?.wallet_private_key) {
    const envName = `${SLUG.toUpperCase().replace(/-/g, '_')}_WALLET_PRIVATE_KEY`;
    console.log(`  1. Add ${envName} to .env.local + Vercel + VPS (full key in ${credPath}).`);
  } else {
    console.log(`  1. Add new wallet PK env var to .env.local + Vercel + VPS (see credentials JSON).`);
  }
  console.log(`  2. Once user provides TG bot token: store env var, edit BRAND_BOTS in lib/rrg/brand-telegram-bot.ts,`);
  console.log(`     call https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://realrealgenuine.com/api/brand/telegram-webhook?brand=${SLUG}`);
  console.log(`  3. Create Notion Onboarding page for ${SLUG} under parent 34ddbc7b67f2809786a8d6ecf8e24f9c ("Brand Onboarding Guidelines").`);
  console.log(`     Template: "Brand Welcome Guide: Template" 34ddbc7b67f2811cb869e07b84e0e03a. Replace <your-slug> throughout with ${SLUG}.`);
  console.log(`  4. Share BOTH Notion page URLs (Stage 1 Integration + Stage 2 Onboarding) with the user to forward to the brand.`);
  console.log(`  5. Verify the test badge in /admin/rrg Drops tab. Unhide for trial purchase, then re-hide.`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
