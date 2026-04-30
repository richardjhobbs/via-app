/**
 * scripts/clooudie-mirror.mjs
 *
 * One-shot mirror of clooudie.com Shopify catalogue into RRG.
 *
 * Phase 1 — seed brand: ensures `clooudie` row exists in rrg_brands, uploads
 *           banner from local file path if banner_path is unset.
 * Phase 2 — import:    fetches https://clooudie.com/products.json, for each
 *           product: skip if already imported, otherwise upload image →
 *           claim tokenId → registerDrop on-chain → insert rrg_submissions row.
 *
 * Idempotent — safe to re-run. Skips products whose `title` already exists
 * for the brand (no schema migration needed).
 *
 * Usage:
 *   node scripts/clooudie-mirror.mjs                         # seed + import all
 *   node scripts/clooudie-mirror.mjs --only creatine-gum     # one product (smoke test)
 *   node scripts/clooudie-mirror.mjs --handles a,b,c         # subset
 *   node scripts/clooudie-mirror.mjs --dry-run               # no DB writes, no on-chain
 *   node scripts/clooudie-mirror.mjs --seed-only             # only ensure brand row
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_RRG_CONTRACT_ADDRESS, NEXT_PUBLIC_BASE_RPC_URL
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, basename } from 'path';
import { randomUUID } from 'crypto';

// ── Config ───────────────────────────────────────────────────────────
const BRAND_SLUG       = 'clooudie';
const BRAND_NAME       = 'Clooudie';
const BRAND_WALLET     = '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7';
const BRAND_EMAIL      = 'richard@entrepot.asia';
const BRAND_HEADLINE   = 'Functional supplement gums — now on Base';
const BRAND_DESCRIPTION= 'Demo mirror of clooudie.com — checkout in USDC on Base, ships from Clooudie.';
const BRAND_WEBSITE    = 'https://clooudie.com';
const SHOPIFY_DOMAIN   = 'clooudie.com';
const BANNER_LOCAL     = 'C:/Users/Richard/Downloads/cloudie_banner.jpg';
const FIXED_EDITION    = 50;
const BUCKET           = 'rrg-submissions';

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
} catch {
  console.error('FATAL: could not read .env.local');
  process.exit(1);
}

const requireEnv = (k) => {
  if (!process.env[k]) { console.error(`FATAL: ${k} not set`); process.exit(1); }
  return process.env[k];
};

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
const RPC_URL      = requireEnv('NEXT_PUBLIC_BASE_RPC_URL');
const RRG_ADDR     = requireEnv('NEXT_PUBLIC_RRG_CONTRACT_ADDRESS');
const DEPLOYER_PK  = requireEnv('DEPLOYER_PRIVATE_KEY');

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};
const ONLY      = flag('--only');
const HANDLES   = flag('--handles');
const DRY_RUN   = args.includes('--dry-run');
const SEED_ONLY = args.includes('--seed-only');

const handleFilter = ONLY
  ? new Set([ONLY])
  : (HANDLES ? new Set(String(HANDLES).split(',').map(h => h.trim()).filter(Boolean)) : null);

console.log(`──── Clooudie mirror ────`);
console.log(`Network:        base mainnet`);
console.log(`RRG contract:   ${RRG_ADDR}`);
console.log(`Brand wallet:   ${BRAND_WALLET}`);
console.log(`Dry run:        ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
console.log(`Filter:         ${handleFilter ? Array.from(handleFilter).join(', ') : '<all>'}`);
console.log();

// ── Clients ──────────────────────────────────────────────────────────
const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(DEPLOYER_PK, provider);
const RRG_ABI  = [
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function getDrop(uint256 tokenId) external view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
];
const rrg = new ethers.Contract(RRG_ADDR, RRG_ABI, signer);

// Explicit nonce tracking — Base public RPC sometimes reports stale nonce
// for back-to-back tx, so we manage it ourselves after the initial fetch.
let _nextNonce = null;
async function nextNonce() {
  if (_nextNonce === null) {
    _nextNonce = await signer.getNonce('latest');
  }
  return _nextNonce++;
}

const toUsdc6dp = (n) => BigInt(Math.round(n * 1_000_000));
const stripHtml = (h) => (h ?? '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

const detectImage = (buf) => {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)
    return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
    return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 12 && buf.slice(0,4).toString() === 'RIFF' && buf.slice(8,12).toString() === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  return null;
};

// ────────────────────────────────────────────────────────────────────
// PHASE 1 — Seed brand
// ────────────────────────────────────────────────────────────────────
async function ensureBrand() {
  console.log(`[seed] looking up brand slug=${BRAND_SLUG}…`);
  const { data: existing } = await db
    .from('rrg_brands')
    .select('*')
    .eq('slug', BRAND_SLUG)
    .maybeSingle();

  let brand = existing;

  if (!brand) {
    if (DRY_RUN) {
      console.log('[seed] DRY: would insert brand row');
      return null;
    }
    const id = randomUUID();
    const insert = {
      id,
      slug:               BRAND_SLUG,
      name:               BRAND_NAME,
      headline:           BRAND_HEADLINE,
      description:        BRAND_DESCRIPTION,
      website_url:        BRAND_WEBSITE,
      contact_email:      BRAND_EMAIL,
      wallet_address:     BRAND_WALLET.toLowerCase(),
      status:             'active',
      max_self_listings:  30,
      self_listings_used: 0,
      tc_accepted_at:     new Date().toISOString(),
      tc_version:         '1.0',
      social_links:       {},
    };
    const { data, error } = await db.from('rrg_brands').insert(insert).select().single();
    if (error) { console.error('[seed] insert failed:', error); process.exit(1); }
    brand = data;
    console.log(`[seed] created brand id=${brand.id}`);
  } else {
    console.log(`[seed] found existing brand id=${brand.id}, banner_path=${brand.banner_path ?? 'null'}`);
  }

  // Upload banner if missing
  if (!brand.banner_path) {
    let buf;
    try {
      buf = readFileSync(BANNER_LOCAL);
    } catch (e) {
      console.warn(`[seed] banner file not found at ${BANNER_LOCAL} — skipping banner upload`);
      return brand;
    }
    const fmt = detectImage(buf);
    if (!fmt) {
      console.warn(`[seed] banner not a recognised image — skipping`);
      return brand;
    }
    const path = `brands/${BRAND_SLUG}/banner-${Date.now()}.${fmt.ext}`;
    if (DRY_RUN) {
      console.log(`[seed] DRY: would upload banner to ${path}`);
    } else {
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, {
        contentType: fmt.mime, upsert: false,
      });
      if (upErr) { console.error('[seed] banner upload failed:', upErr); process.exit(1); }
      const { error: updErr } = await db.from('rrg_brands')
        .update({ banner_path: path })
        .eq('id', brand.id);
      if (updErr) { console.error('[seed] banner_path update failed:', updErr); process.exit(1); }
      brand.banner_path = path;
      console.log(`[seed] uploaded banner → ${path}`);
    }
  }

  return brand;
}

// ────────────────────────────────────────────────────────────────────
// PHASE 2 — Import products
// ────────────────────────────────────────────────────────────────────

async function fetchShopify() {
  const url = `https://${SHOPIFY_DOMAIN}/products.json?limit=50`;
  console.log(`[shopify] GET ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'RRG-Mirror/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const json = await res.json();
  console.log(`[shopify] received ${json.products?.length ?? 0} products`);
  return json.products ?? [];
}

async function claimNextTokenId() {
  const { data: cfg, error: e1 } = await db
    .from('rrg_config').select('value').eq('key', 'next_token_id').single();
  if (e1) throw new Error(`rrg_config read: ${e1.message}`);
  const current = parseInt(cfg.value, 10);
  const next = current + 1;
  const { error: e2 } = await db
    .from('rrg_config').update({ value: String(next) }).eq('key', 'next_token_id');
  if (e2) throw new Error(`rrg_config update: ${e2.message}`);
  return current;
}

async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RRG-Mirror/1.0' } });
  if (!res.ok) throw new Error(`image ${url} → ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function importProduct(product, brand) {
  const handle  = product.handle;
  const title   = product.title;
  const variant = product.variants?.[0];
  const image   = product.images?.[0];

  if (!variant) { console.warn(`[skip ${handle}] no variant`); return null; }
  if (!image)   { console.warn(`[skip ${handle}] no image`); return null; }

  const price = parseFloat(variant.price);
  if (!Number.isFinite(price) || price < 0.01 || price > 500) {
    console.warn(`[skip ${handle}] price out of range: ${variant.price}`);
    return null;
  }

  // Dedupe by title within brand
  const { data: existing } = await db
    .from('rrg_submissions')
    .select('id, token_id')
    .eq('brand_id', brand.id)
    .eq('title', title)
    .maybeSingle();
  if (existing) {
    console.log(`[skip ${handle}] already imported as token #${existing.token_id}`);
    return existing;
  }

  console.log(`[import ${handle}] $${price.toFixed(2)} USDC, edition ${FIXED_EDITION}`);

  if (DRY_RUN) {
    console.log(`[import ${handle}] DRY — would upload image, claim tokenId, registerDrop, insert row`);
    return null;
  }

  // Download + upload image
  const imgBuf = await downloadImage(image.src);
  const fmt = detectImage(imgBuf);
  if (!fmt) throw new Error(`${handle} image not jpeg/png/webp`);

  const submissionId = randomUUID();
  const filename     = `clooudie-${handle}-${Date.now()}.${fmt.ext}`;
  const path         = `submissions/${submissionId}/jpeg/${filename}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, imgBuf, {
    contentType: fmt.mime, upsert: false,
  });
  if (upErr) throw new Error(`image upload: ${upErr.message}`);

  // Claim tokenId
  const tokenId = await claimNextTokenId();

  // On-chain registerDrop with explicit nonce
  const nonce = await nextNonce();
  console.log(`  → registerDrop(${tokenId}, ${BRAND_WALLET}, ${toUsdc6dp(price)}, ${FIXED_EDITION})  [nonce=${nonce}]`);
  const tx = await rrg.registerDrop(
    tokenId,
    BRAND_WALLET,
    toUsdc6dp(price),
    FIXED_EDITION,
    { nonce },
  );
  const receipt = await tx.wait(1);
  console.log(`  → mined ${receipt.hash}`);

  // Insert rrg_submissions row
  const description = stripHtml(product.body_html).slice(0, 1500) || null;
  const insertRow = {
    id:                  submissionId,
    creator_wallet:      BRAND_WALLET.toLowerCase(),
    creator_email:       BRAND_EMAIL,
    title:               title.slice(0, 60),
    description,
    submission_channel:  'brand',
    status:              'approved',
    jpeg_storage_path:   path,
    jpeg_filename:       filename,
    jpeg_size_bytes:     imgBuf.length,
    brand_id:            brand.id,
    creator_type:        'human',
    is_brand_product:    true,
    token_id:            tokenId,
    edition_size:        FIXED_EDITION,
    price_usdc:          price.toFixed(2),
    approved_at:         new Date().toISOString(),
    network:             'base',
    is_physical_product: true,
    physical_description: null,
    physical_images_paths: null,
    price_includes_tax:    false,
    price_includes_packing:false,
    ecommerce_url:         `https://clooudie.com/products/${handle}`,
    shipping_type:         'live_rates',
    shipping_included_regions: null,
    shopify_variant_gid:   `gid://shopify/ProductVariant/${variant.id}`,
    refund_commitment:     true,
    collection_in_person:  null,
    trust_behavior_accepted:true,
    has_voucher:           false,
    voucher_template_id:   null,
    hidden:                false,
  };
  const { error: insErr } = await db.from('rrg_submissions').insert(insertRow);
  if (insErr) throw new Error(`insert: ${insErr.message}`);

  // Bump self_listings_used
  await db.from('rrg_brands')
    .update({ self_listings_used: (brand.self_listings_used ?? 0) + 1 })
    .eq('id', brand.id);
  brand.self_listings_used = (brand.self_listings_used ?? 0) + 1;

  console.log(`  ✓ token #${tokenId} → /rrg/drop/${tokenId}`);
  return { id: submissionId, token_id: tokenId };
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────
(async () => {
  const brand = await ensureBrand();
  if (!brand) { console.log('[done] dry seed — exiting'); return; }
  if (SEED_ONLY) { console.log('[done] seed only — exiting'); return; }

  const products = await fetchShopify();
  const filtered = handleFilter
    ? products.filter(p => handleFilter.has(p.handle))
    : products;

  if (handleFilter && filtered.length === 0) {
    console.error(`No products matched handles: ${Array.from(handleFilter).join(', ')}`);
    console.error(`Available: ${products.map(p => p.handle).join(', ')}`);
    process.exit(1);
  }

  console.log(`[import] processing ${filtered.length} of ${products.length} products`);
  console.log();

  const results = [];
  for (const p of filtered) {
    try {
      const r = await importProduct(p, brand);
      if (r) results.push(r);
    } catch (e) {
      console.error(`[FAIL ${p.handle}]`, e.message ?? e);
    }
    console.log();
  }

  console.log(`──── Done ────`);
  console.log(`Imported / found ${results.length} listings`);
  console.log(`Brand storefront: https://realrealgenuine.com/brand/${BRAND_SLUG}`);
  console.log(`Catalogue:        https://realrealgenuine.com/api/rrg/catalogue?brand=${BRAND_SLUG}`);
  for (const r of results) {
    if (r.token_id != null) console.log(`  • token #${r.token_id} → /rrg/drop/${r.token_id}`);
  }
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
