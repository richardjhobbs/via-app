/**
 * scripts/provision-event.mjs
 *
 * Repeat-deployable provisioning for the VIA ticketing / event channel. Turns one
 * event config file (events/<slug>.json) into a live VIA store: one seller (the
 * event), one voucher product per pass tier, and the concierge's seeded memories.
 * The next event is a new config file, not new code.
 *
 * Reuses the existing framework end to end:
 *   - the store is an ordinary app_sellers row (so the per-seller MCP, the human
 *     CheckoutBox, x402 settlement and the 97.5% payout all apply unchanged);
 *   - each tier is an app_seller_products row, kind 'digital', priced in USDC,
 *     marked metadata.voucher=true so settlement draws a UNIQUE redemption code
 *     per buyer from the voucher pool (migration 0031, lib/app/vouchers.ts);
 *   - tiers are left on_chain_status 'draft' so mint-on-sale registers the drop
 *     at first purchase (we mint only what sells).
 *
 * Idempotent: re-running upserts the seller by slug, each tier by (seller_id,
 * title), and each concierge fact by (seller_id, title). Safe to re-run as the
 * event details firm up.
 *
 * Usage:
 *   node scripts/provision-event.mjs events/sbw-2026.json
 *   node scripts/provision-event.mjs events/sbw-2026.json --owner <auth-user-uuid>
 *   node scripts/provision-event.mjs events/sbw-2026.json --codes visitor=./visitor-codes.txt --codes vip=./vip-codes.txt
 *   node scripts/provision-event.mjs events/sbw-2026.json --enable   # also mint the store identity (needs ADMIN_SECRET + BASE)
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or
 * SUPABASE_SERVICE_KEY). For --enable also: ADMIN_SECRET, and BASE (defaults to
 * https://app.getvia.xyz).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';

// ── Load .env.local ────────────────────────────────────────────────────
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {
  console.error('FATAL: could not read .env.local'); process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: Supabase env missing'); process.exit(1); }

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith('--') && /\.json$/.test(a));
if (!configPath) { console.error('FATAL: pass an event config path, e.g. events/sbw-2026.json'); process.exit(1); }

const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ownerFlag = flag('--owner');
const doEnable  = args.includes('--enable');
// --codes <tierKey>=<path> may appear more than once.
const codeFiles = {};
args.forEach((a, i) => {
  if (a === '--codes' && args[i + 1]) {
    const [key, path] = args[i + 1].split('=');
    if (key && path) codeFiles[key.trim()] = path.trim();
  }
});

const cfg = JSON.parse(readFileSync(resolve(process.cwd(), configPath), 'utf8'));
for (const req of ['slug', 'name', 'tiers']) {
  if (!cfg[req]) { console.error(`FATAL: config missing "${req}"`); process.exit(1); }
}

const SLUG = cfg.slug;
const ZERO = '0x0000000000000000000000000000000000000000';
const payoutWallet = String(cfg.payout_wallet || '').trim();
const payoutLooksReal = /^0x[0-9a-fA-F]{40}$/.test(payoutWallet) && payoutWallet.toLowerCase() !== ZERO;
if (!payoutLooksReal) {
  console.warn(`[provision] WARNING: payout_wallet is a placeholder. The store is seeded but payouts will fail until you set a real USDC wallet on Base and re-run.`);
}

// ── Owner (FK to auth.users): borrow an existing seller's owner ─────────
async function resolveOwner() {
  if (ownerFlag) return ownerFlag;
  const { data, error } = await db
    .from('app_sellers').select('owner_user_id, slug').neq('slug', SLUG).limit(1).maybeSingle();
  if (error) throw new Error(`owner lookup: ${error.message}`);
  if (!data?.owner_user_id) {
    console.error('FATAL: no existing seller to borrow an owner_user_id from. Pass --owner <auth-user-uuid>.');
    process.exit(1);
  }
  console.log(`[provision] reusing owner_user_id from seller "${data.slug}"`);
  return data.owner_user_id;
}

// ── Build a voucher product row from a tier ────────────────────────────
function tierToProduct(tier) {
  const priceUsdc = Number(tier.price_usdc);
  if (!Number.isFinite(priceUsdc) || priceUsdc <= 0) throw new Error(`tier ${tier.key}: price_usdc must be a positive number`);
  const allocation = Number.isFinite(Number(tier.allocation)) ? Number(tier.allocation) : null;
  return {
    kind:            'digital',          // a pass is a digital good, delivered as a code
    title:           tier.title,
    description:     tier.includes || `${cfg.name} pass.`,
    price_minor:     Math.round(priceUsdc * 1_000_000),
    currency:        'USDC',
    stock:           null,               // real inventory is the voucher pool, not this column
    active:          true,
    pricing_mode:    'fixed',
    on_chain_status: 'draft',            // mint-on-sale registers the drop at first purchase
    max_supply:      allocation,         // on-chain edition ceiling; keep aligned with codes loaded
    metadata: {
      voucher:    true,
      redemption: cfg.redemption ?? null,
      // Fulfilment mode (code_pool default, or luma_api with auto-fallback). The
      // Luma API key is never stored here, only the name of the env var holding it.
      fulfilment: cfg.fulfilment
        ? { mode: cfg.fulfilment.mode ?? 'code_pool', luma_event_api_id: cfg.fulfilment.luma_event_api_id, luma_api_key_env: cfg.fulfilment.luma_api_key_env }
        : { mode: 'code_pool' },
      event_slug: SLUG,
      tier_key:   tier.key,
      via_enrichment: {
        agentDescription: `${tier.title} for ${cfg.name}. ${tier.includes || ''}`.trim(),
        category:   'event-pass',
        tags:       ['event', 'ticket', 'pass', SLUG],
        attributes: { event: cfg.name, tier: tier.key },
      },
    },
  };
}

async function upsertProduct(sellerId, product) {
  const { data: existing } = await db
    .from('app_seller_products')
    .select('id').eq('seller_id', sellerId).eq('title', product.title).maybeSingle();
  if (existing) {
    const { error } = await db.from('app_seller_products')
      .update({ ...product, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) throw new Error(`product update (${product.title}): ${error.message}`);
    console.log(`[provision] updated tier  ${product.title}  (${existing.id})`);
    return existing.id;
  }
  const { data, error } = await db.from('app_seller_products')
    .insert({ ...product, seller_id: sellerId }).select('id').single();
  if (error) throw new Error(`product insert (${product.title}): ${error.message}`);
  console.log(`[provision] created tier  ${product.title}  (${data.id})`);
  return data.id;
}

// ── Concierge memory upsert (by seller_id + title) ─────────────────────
async function upsertMemory(sellerId, ownerId, fact) {
  const type = ['event', 'stock_note', 'promotion', 'brand_update', 'policy', 'general'].includes(fact.type)
    ? fact.type : 'general';
  const { data: existing } = await db
    .from('app_seller_memories')
    .select('id').eq('seller_id', sellerId).eq('title', fact.title).maybeSingle();
  const row = { seller_id: sellerId, type, title: fact.title, body: fact.body, active: true, created_by: ownerId };
  if (existing) {
    const { error } = await db.from('app_seller_memories').update(row).eq('id', existing.id);
    if (error) throw new Error(`memory update (${fact.title}): ${error.message}`);
    return;
  }
  const { error } = await db.from('app_seller_memories').insert(row);
  if (error) throw new Error(`memory insert (${fact.title}): ${error.message}`);
}

// ── Voucher code loading (--codes tierKey=path) ────────────────────────
async function loadCodes(sellerId, tierIdByKey) {
  for (const [tierKey, path] of Object.entries(codeFiles)) {
    const productId = tierIdByKey[tierKey];
    if (!productId) { console.warn(`[provision] --codes ${tierKey}: no such tier, skipping`); continue; }
    const raw = readFileSync(resolve(process.cwd(), path), 'utf8').split(/\r?\n/);
    const seen = new Set();
    const rows = raw.map((c) => c.trim())
      .filter((c) => c && !seen.has(c) && seen.add(c))
      .map((code) => ({ seller_id: sellerId, product_id: productId, code }));
    if (rows.length === 0) { console.warn(`[provision] --codes ${tierKey}: file empty`); continue; }
    const { data, error } = await db.from('app_voucher_codes')
      .upsert(rows, { onConflict: 'product_id,code', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`code load (${tierKey}): ${error.message}`);
    console.log(`[provision] loaded ${data?.length ?? 0} new code(s) into tier "${tierKey}" (${rows.length} in file)`);
  }
}

// ── Optionally mint the store identity so it is transactable ────────────
async function enableAgent(sellerId) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) { console.warn('[provision] --enable set but ADMIN_SECRET missing; skipping. Enable from the superadmin instead.'); return; }
  const base = process.env.BASE || 'https://app.getvia.xyz';
  const nonce = crypto.randomBytes(32).toString('hex');
  const exp = String(Date.now() + 1000 * 60 * 10);
  const sig = crypto.createHmac('sha256', secret).update(`${nonce}.${exp}`).digest('hex');
  const token = `${nonce}.${exp}.${sig}`;
  const res = await fetch(`${base}/api/admin/sellers/${sellerId}/enable-agent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `admin_token=${token}` },
  });
  console.log(`[provision] enable-agent (${res.status}): ${await res.text()}`);
}

// ── Run ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(`──── Provision event: ${cfg.name} (/sellers/${SLUG}) ────`);
  const ownerId = await resolveOwner();

  const seller = {
    slug:          SLUG,
    name:          cfg.name,
    kind:          'service',
    contact_email: cfg.contact_email || `tickets@${SLUG}.example`,
    website_url:   cfg.website || null,
    headline:      cfg.headline || `Buy your ${cfg.name} pass in USDC.`,
    description:   cfg.description || `The official VIA channel for ${cfg.name} passes.`,
    wallet_address: payoutLooksReal ? payoutWallet : ZERO,
    active:        true,
    owner_user_id: ownerId,
  };

  const { data: existing } = await db.from('app_sellers').select('id').eq('slug', SLUG).maybeSingle();
  let sellerId;
  if (existing) {
    const { error } = await db.from('app_sellers')
      .update({ ...seller, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) throw new Error(`seller update: ${error.message}`);
    sellerId = existing.id;
    console.log(`[provision] updated store id=${sellerId}`);
  } else {
    const { data, error } = await db.from('app_sellers').insert(seller).select('id').single();
    if (error) throw new Error(`seller insert: ${error.message}`);
    sellerId = data.id;
    console.log(`[provision] created store id=${sellerId}`);
  }

  const tierIdByKey = {};
  for (const tier of cfg.tiers) {
    tierIdByKey[tier.key] = await upsertProduct(sellerId, tierToProduct(tier));
  }

  // Seed concierge memories: the config facts plus a generated tier/price summary
  // and the redemption note, so ask_sales_agent can answer "what tiers, how much,
  // how do I redeem" out of the box.
  const facts = [...(cfg.concierge_facts || [])];
  facts.push({
    type: 'general',
    title: 'Pass tiers and prices',
    body: cfg.tiers.map((t) => `${t.title}: ${Number(t.price_usdc).toFixed(2)} USDC. ${t.includes || ''}`.trim()).join('\n'),
  });
  if (cfg.redemption?.instructions) {
    facts.push({ type: 'general', title: 'Redeeming your pass', body: cfg.redemption.instructions });
  }
  for (const fact of facts) await upsertMemory(sellerId, ownerId, fact);
  console.log(`[provision] seeded ${facts.length} concierge memory item(s)`);

  if (Object.keys(codeFiles).length > 0) await loadCodes(sellerId, tierIdByKey);
  if (doEnable) await enableAgent(sellerId);

  console.log('──── Done ────');
  console.log(`Store:    ${cfg.name}  (/sellers/${SLUG})`);
  console.log(`Agent MCP: /sellers/${SLUG}/mcp`);
  console.log(`Admin:    /seller/${SLUG}/admin`);
  console.log(`Tiers:    ${cfg.tiers.length} voucher products (draft, active; minted at first sale)`);
  if (!doEnable) {
    console.log('\nNext: enable the store agent so it is transactable (mints its identity + agent wallet):');
    console.log(`  - superadmin: open /admin and enable the agent for "${cfg.name}", OR`);
    console.log(`  - re-run with --enable (needs ADMIN_SECRET + BASE).`);
  }
  console.log('Then load redemption codes per tier: re-run with --codes <tierKey>=<file>, one code per line.');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
