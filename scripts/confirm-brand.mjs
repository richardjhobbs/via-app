/**
 * scripts/confirm-brand.mjs
 *
 * STAGE 2 brand-onboarding orchestrator. Run after a Stage 1 brand
 * (created by onboard-brand.mjs) has been confirmed by the brand owner
 * and they have provided their public Shopify Storefront API access token
 * + admin email.
 *
 *   node scripts/confirm-brand.mjs --slug <slug> \
 *        --admin-email <email> \
 *        [--shopify-token <tok>] \
 *        [--shopify-domain <host>] \
 *        [--skip-wallet] [--skip-badge] [--dry-run]
 *
 *   --shopify-token is the brand's PUBLIC Storefront access token (Shopify
 *   Admin > Sales channels > Headless > Storefront API > "Public access
 *   token"; a 32-hex string). Not a private/shpat_ token, not an Admin token.
 *
 * What it does:
 *   1. Verifies the brand row exists in app_sellers.
 *   2. Updates app_sellers.contact_email and (if provided)
 *      shopify_storefront_token_encrypted + shopify_domain.
 *   3. Spawns scripts/register-brand-agent.mjs --brand <slug> to:
 *        a. generate a fresh EOA owned by the brand
 *        b. fund it from DEPLOYER (~0.00005 ETH)
 *        c. register on ERC-8004 Identity Registry (Base mainnet)
 *        d. update app_sellers.wallet_address to the new wallet
 *        e. write credentials JSON to tmp/<slug>-credentials-<ts>.json
 *      Skip with --skip-wallet (e.g. re-runs).
 *   4. Spawns scripts/create-membership-listings.mjs --brand <slug> --hidden
 *      to mint a test membership badge that stays hidden=true until you
 *      manually unhide it in /admin Drops tab. Skip with --skip-badge.
 *   5. Prints a summary with the new wallet, agent ID, badge token ID,
 *      and the manual TG-bot setup instructions (still required because
 *      BRAND_BOTS in lib/app/brand-telegram-bot.ts is hardcoded today).
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
 *     the repo yet, so this script stores the token wrapped as
 *     "plaintext:<token>". lib/app/shopify-shipping.ts only reads tokens
 *     with that prefix; a raw token yields source: fallback_zero (no rates).
 *     The credential is the brand's PUBLIC Storefront access token (a 32-hex
 *     string from Shopify Admin > Sales channels > Headless > Storefront API
 *     > "Public access token"), NOT a private token (the ones beginning
 *     shpat_) and NOT any Admin API credential. Treat the stored value as
 *     the same trust boundary as SUPABASE_SERVICE_KEY.
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
  console.error('  --shopify-token is the PUBLIC Storefront access token (Headless > Storefront API > "Public access token"), not a private/shpat_ or Admin token.');
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
    .from('app_sellers')
    .select('id, slug, name, status, wallet_address, contact_email, shopify_domain')
    .eq('slug', SLUG)
    .maybeSingle();
  if (brandErr) { console.error(`FATAL: app_sellers lookup error: ${brandErr.message}`); process.exit(1); }
  if (!brand) { console.error(`FATAL: brand "${SLUG}" not found in app_sellers. Run onboard-brand.mjs first.`); process.exit(1); }
  console.log(`[db] found brand id=${brand.id} status=${brand.status}`);
  console.log(`[db] current wallet:  ${brand.wallet_address}`);
  console.log(`[db] current email:   ${brand.contact_email}`);
  console.log(`[db] current shopify: ${brand.shopify_domain ?? '(none)'}`);
  console.log();

  // 2. Apply DB updates (admin email + optional shopify token/domain)
  const updates = {};
  if (ADMIN_EMAIL && typeof ADMIN_EMAIL === 'string') updates.contact_email = ADMIN_EMAIL.toLowerCase();
  if (SHOPIFY_TOKEN && typeof SHOPIFY_TOKEN === 'string') {
    // shopify-shipping.ts only reads tokens stored with a "plaintext:" prefix
    // (the encrypted path is an unimplemented TODO). Wrap idempotently and
    // trim, since copy-pasted tokens often carry trailing whitespace.
    const t = SHOPIFY_TOKEN.trim();
    updates.shopify_storefront_token_encrypted = t.startsWith('plaintext:') ? t : `plaintext:${t}`;
  }
  if (SHOPIFY_DOMAIN && typeof SHOPIFY_DOMAIN === 'string') updates.shopify_domain = SHOPIFY_DOMAIN.toLowerCase();

  if (Object.keys(updates).length > 0) {
    console.log(`[db] applying updates: ${Object.keys(updates).join(', ')}`);
    if (!DRY_RUN) {
      const { error } = await db.from('app_sellers').update(updates).eq('id', brand.id);
      if (error) { console.error(`FATAL: app_sellers update failed: ${error.message}`); process.exit(1); }
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

  // 4.5 Activate the Brand Concierge (auth user + app_seller_members admin
  //     + welcome email). Idempotent, skips if an admin already exists.
  console.log(`──── Spawning activate-brand-concierge ────`);
  {
    const childArgs = ['scripts/activate-brand-concierge.mjs', '--slug', SLUG];
    if (DRY_RUN) childArgs.push('--dry-run');
    const result = spawnSync('node', childArgs, { stdio: 'inherit', cwd: process.cwd() });
    if (result.status !== 0) {
      console.error(`WARNING: activate-brand-concierge exited with code ${result.status} (continuing; re-run manually if needed)`);
    }
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
  console.log(`Concierge:      owner login + welcome email auto-activated. Hermes runtime is queued (app_sellers.hermes_concierge_status='pending').`);
  console.log(`                Drain the queue from your desktop:  pwsh -File via-agent-wiki/scripts/process-pending-concierges.ps1`);
  console.log(`                (Requires $env:RRG_ADMIN_SECRET and $env:CONCIERGE_KEY_SECRET in that shell; SSH access to the Box.)`);
  if (creds) {
    console.log(`New wallet:     ${creds.wallet_address}`);
    console.log(`Agent ID:       ${creds.erc8004_agent_id ?? '(unknown)'}`);
    console.log(`Credentials:    ${credPath}`);
  }
  console.log();
  console.log(`Operator reminder (show to user):`);
  console.log(`  Telegram bot is OPTIONAL and experimental, not a prerequisite for the concierge.`);
  console.log(`  Only create one via @BotFather if this brand will actively use it.`);
  console.log();
  console.log(`Claude must now do these without asking permission (single-instruction rule):`);
  if (creds?.wallet_private_key) {
    const envName = `${SLUG.toUpperCase().replace(/-/g, '_')}_WALLET_PRIVATE_KEY`;
    console.log(`  1. Add ${envName} to .env.local + Vercel + VPS (full key in ${credPath}).`);
  } else {
    console.log(`  1. Add new wallet PK env var to .env.local + Vercel + VPS (see credentials JSON).`);
  }
  console.log(`  2. (Optional, only if a TG bot is wanted) store env var, add to BRAND_BOTS in lib/app/brand-telegram-bot.ts,`);
  console.log(`     call https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://realrealgenuine.com/api/seller/telegram-webhook?brand=${SLUG}`);
  console.log(`  3. Create the Notion Onboarding page for ${SLUG} by duplicating "Brand Welcome Guide: Template"`);
  console.log(`     (34ddbc7b67f2811cb869e07b84e0e03a) under parent 34ddbc7b67f2809786a8d6ecf8e24f9c ("Brand Onboarding Guidelines").`);
  console.log(`     Replace <your-slug> throughout with ${SLUG}, fill in the wallet address, and set the Concierge bot handle.`);
  console.log(`  4. Reply with BOTH Notion page URLs (Stage 1 Integration + Stage 2 Onboarding) so the user can forward them to the brand.`);
  console.log(`  5. Verify the test badge in /admin Drops tab. Unhide for trial purchase, then re-hide.`);
  console.log(`  Do NOT pause to ask "shall I create this?" The script printing this block is the instruction.`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
