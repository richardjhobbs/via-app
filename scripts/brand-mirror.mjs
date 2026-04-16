/**
 * scripts/brand-mirror.mjs
 *
 * Generalized Shopify-to-RRG mirror. Config-driven from a JSON block per brand.
 * Unlike clooudie-mirror.mjs, this imports ALL variants per product (size/color)
 * into rrg_product_variants and supports garment brands with sizing.
 *
 * Usage:
 *   node scripts/brand-mirror.mjs --brand unknown-union          # full import
 *   node scripts/brand-mirror.mjs --brand unknown-union --only seven-society-rugby-shirt
 *   node scripts/brand-mirror.mjs --brand unknown-union --dry-run
 *   node scripts/brand-mirror.mjs --brand unknown-union --seed-only
 *   node scripts/brand-mirror.mjs --brand unknown-union --skip-chain  # DB only, no registerDrop
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_RRG_CONTRACT_ADDRESS, NEXT_PUBLIC_BASE_RPC_URL
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

// ── Brand configs ────────────────────────────────────────────────────
const BRANDS = {
  'unknown-union': {
    slug:            'unknown-union',
    name:            'Unknown Union',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'One book. Many stories.',
    description:     'Unknown Union — narrative-driven streetwear and culture fashion, centered on the idea of an "unknown union" that binds humanity across borders. Mirror of shop.unknownunion.com — checkout in USDC on Base, ships from UU.',
    website:         'https://shop.unknownunion.com',
    shopifyDomain:   'shop.unknownunion.com',
    supportsSizing:  true,
    socialLinks:     { instagram: 'https://www.instagram.com/unknownunion/' },
    bannerLocal:     null, // upload via Supabase storage separately
    logoLocal:       null,
  },
};

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
const BUCKET       = 'rrg-submissions';

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};

const BRAND_KEY  = flag('--brand');
const ONLY       = flag('--only');
const HANDLES    = flag('--handles');
const DRY_RUN    = args.includes('--dry-run');
const SEED_ONLY  = args.includes('--seed-only');
const SKIP_CHAIN = args.includes('--skip-chain');

if (!BRAND_KEY || !BRANDS[BRAND_KEY]) {
  console.error(`Usage: node scripts/brand-mirror.mjs --brand <slug>`);
  console.error(`Available: ${Object.keys(BRANDS).join(', ')}`);
  process.exit(1);
}

const CFG = BRANDS[BRAND_KEY];
const handleFilter = ONLY
  ? new Set([ONLY])
  : (HANDLES ? new Set(String(HANDLES).split(',').map(h => h.trim()).filter(Boolean)) : null);

console.log(`──── Brand Mirror: ${CFG.name} ────`);
console.log(`Shopify:   ${CFG.shopifyDomain}`);
console.log(`Sizing:    ${CFG.supportsSizing ? 'YES' : 'no'}`);
console.log(`Dry run:   ${DRY_RUN ? 'YES' : 'no'}`);
console.log(`Skip chain:${SKIP_CHAIN ? 'YES' : 'no'}`);
console.log(`Filter:    ${handleFilter ? Array.from(handleFilter).join(', ') : '<all>'}`);
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
  console.log(`[seed] looking up brand slug=${CFG.slug}…`);
  const { data: existing } = await db
    .from('rrg_brands')
    .select('*')
    .eq('slug', CFG.slug)
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
      slug:               CFG.slug,
      name:               CFG.name,
      headline:           CFG.headline,
      description:        CFG.description,
      website_url:        CFG.website,
      contact_email:      CFG.email,
      wallet_address:     CFG.wallet.toLowerCase(),
      status:             'active',
      max_self_listings:  30,
      self_listings_used: 0,
      tc_accepted_at:     new Date().toISOString(),
      tc_version:         '1.0',
      social_links:       CFG.socialLinks ?? {},
      shopify_domain:     CFG.shopifyDomain,
      supports_sizing:    CFG.supportsSizing ?? false,
    };
    const { data, error } = await db.from('rrg_brands').insert(insert).select().single();
    if (error) { console.error('[seed] insert failed:', error); process.exit(1); }
    brand = data;
    console.log(`[seed] created brand id=${brand.id}`);
  } else {
    console.log(`[seed] found existing brand id=${brand.id}`);
    // Ensure shopify fields are set
    if (!existing.shopify_domain && CFG.shopifyDomain) {
      await db.from('rrg_brands').update({
        shopify_domain: CFG.shopifyDomain,
        supports_sizing: CFG.supportsSizing ?? false,
      }).eq('id', brand.id);
      console.log(`[seed] updated shopify_domain + supports_sizing`);
    }
  }

  return brand;
}

// ────────────────────────────────────────────────────────────────────
// PHASE 2 — Import products with full variant matrix
// ────────────────────────────────────────────────────────────────────

async function fetchShopify() {
  const url = `https://${CFG.shopifyDomain}/products.json?limit=50`;
  console.log(`[shopify] GET ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'RRG-Mirror/2.0' }, cache: 'no-store' });
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
  const res = await fetch(url, { headers: { 'User-Agent': 'RRG-Mirror/2.0' } });
  if (!res.ok) throw new Error(`image ${url} → ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Count available variants. Shopify's public products.json exposes
 * `available` (boolean) reliably but often hides `inventory_quantity`.
 * Use `available` as the source of truth.
 */
function getAvailableCount(product) {
  return (product.variants ?? []).filter(v => v.available === true).length;
}

function getTotalStock(product) {
  // If inventory_quantity is available and > 0, use it; otherwise count available variants
  const qtySum = (product.variants ?? []).reduce((sum, v) => {
    const q = parseInt(v.inventory_quantity, 10);
    return sum + (isNaN(q) ? 0 : Math.max(0, q));
  }, 0);
  if (qtySum > 0) return qtySum;
  // Fallback: count each available variant as 1 unit of stock
  return getAvailableCount(product);
}

async function importProduct(product, brand) {
  const handle  = product.handle;
  const title   = product.title;
  const variant = product.variants?.[0];
  const image   = product.images?.[0];

  if (!variant) { console.warn(`[skip ${handle}] no variant`); return null; }
  if (!image)   { console.warn(`[skip ${handle}] no image`); return null; }

  const price = parseFloat(variant.price);
  if (!Number.isFinite(price) || price < 0.01 || price > 1000) {
    console.warn(`[skip ${handle}] price out of range: ${variant.price}`);
    return null;
  }

  // Check stock — skip items with 0 stock unless --force-import is set
  const totalStock = getTotalStock(product);
  const FORCE_IMPORT = args.includes('--force-import');
  if (totalStock <= 0 && !FORCE_IMPORT) {
    console.warn(`[skip ${handle}] no stock (${totalStock}) — use --force-import to override`);
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
    console.log(`[exists ${handle}] already imported as token #${existing.token_id} — syncing variants`);
    await syncVariants(existing.id, product);
    return existing;
  }

  // Edition size = total stock across all variants at time of listing
  const editionSize = Math.max(1, totalStock);

  console.log(`[import ${handle}] $${price.toFixed(2)} USDC, edition ${editionSize} (from stock), ${product.variants.length} variants`);

  if (DRY_RUN) {
    console.log(`[import ${handle}] DRY — would upload image, claim tokenId, registerDrop, insert row + variants`);
    return null;
  }

  // Download + upload image
  const imgBuf = await downloadImage(image.src);
  const fmt = detectImage(imgBuf);
  if (!fmt) throw new Error(`${handle} image not jpeg/png/webp`);

  const submissionId = randomUUID();
  const filename     = `${CFG.slug}-${handle}-${Date.now()}.${fmt.ext}`;
  const path         = `submissions/${submissionId}/jpeg/${filename}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, imgBuf, {
    contentType: fmt.mime, upsert: false,
  });
  if (upErr) throw new Error(`image upload: ${upErr.message}`);

  // Claim tokenId
  const tokenId = await claimNextTokenId();

  // On-chain registerDrop
  if (!SKIP_CHAIN) {
    const nonce = await nextNonce();
    console.log(`  → registerDrop(${tokenId}, ${CFG.wallet}, ${toUsdc6dp(price)}, ${CFG.fixedEdition})  [nonce=${nonce}]`);
    const tx = await rrg.registerDrop(
      tokenId,
      CFG.wallet,
      toUsdc6dp(price),
      editionSize,
      { nonce },
    );
    const receipt = await tx.wait(1);
    console.log(`  → mined ${receipt.hash}`);
  } else {
    console.log(`  → SKIP_CHAIN: skipping registerDrop for token #${tokenId}`);
  }

  // Insert rrg_submissions row
  const description = stripHtml(product.body_html).slice(0, 1500) || null;
  const insertRow = {
    id:                  submissionId,
    creator_wallet:      CFG.wallet.toLowerCase(),
    creator_email:       CFG.email,
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
    edition_size:        editionSize,
    price_usdc:          price.toFixed(2),
    approved_at:         new Date().toISOString(),
    network:             'base',
    is_physical_product: true,
    ecommerce_url:       `https://${CFG.shopifyDomain}/products/${handle}`,
    shipping_type:       'quote_after_payment',
    refund_commitment:   true,
    trust_behavior_accepted: true,
    has_voucher:         false,
    hidden:              false,
  };
  const { error: insErr } = await db.from('rrg_submissions').insert(insertRow);
  if (insErr) throw new Error(`insert submission: ${insErr.message}`);

  // Insert variants
  await syncVariants(submissionId, product);

  // Bump self_listings_used
  await db.from('rrg_brands')
    .update({ self_listings_used: (brand.self_listings_used ?? 0) + 1 })
    .eq('id', brand.id);
  brand.self_listings_used = (brand.self_listings_used ?? 0) + 1;

  console.log(`  ✓ token #${tokenId} → /rrg/drop/${tokenId} (${product.variants.length} variants)`);
  return { id: submissionId, token_id: tokenId };
}

/**
 * Determine which option position holds size vs color based on Shopify's
 * product.options array. Some brands use option1=Size, others option1=Color.
 * Returns { sizeIdx, colorIdx } where 0/1/2 map to option1/option2/option3.
 */
function detectOptionPositions(product) {
  const options = product.options ?? [];
  let sizeIdx = -1;
  let colorIdx = -1;
  for (let i = 0; i < options.length; i++) {
    const name = String(options[i]?.name ?? '').toLowerCase().trim();
    if (sizeIdx === -1 && (name === 'size' || name.includes('size'))) sizeIdx = i;
    else if (colorIdx === -1 && (name === 'color' || name === 'colour' || name.includes('color') || name.includes('colour'))) colorIdx = i;
  }
  // Fallbacks: if only one option, treat as size. If neither matched, default size=0, color=1.
  if (sizeIdx === -1 && colorIdx === -1) { sizeIdx = 0; colorIdx = 1; }
  else if (sizeIdx === -1) sizeIdx = (colorIdx === 0 ? 1 : 0);
  else if (colorIdx === -1) colorIdx = (sizeIdx === 0 ? 1 : 0);
  return { sizeIdx, colorIdx };
}

/**
 * Sync Shopify variants → rrg_product_variants for a given submission.
 * Upserts by shopify_variant_id.
 */
async function syncVariants(submissionId, product) {
  const variants = product.variants ?? [];
  const now = new Date().toISOString();

  const { sizeIdx, colorIdx } = detectOptionPositions(product);

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const shopifyId = String(v.id);
    // Use inventory_quantity if available and > 0; otherwise use `available` boolean (1 or 0)
    const rawQty = parseInt(v.inventory_quantity, 10);
    const stock = (!isNaN(rawQty) && rawQty > 0) ? rawQty : (v.available === true ? 1 : 0);

    // Resolve size/color from option positions (Shopify: option1/2/3 based on product.options order)
    const sizeVal  = [v.option1, v.option2, v.option3][sizeIdx]  ?? null;
    const colorVal = [v.option1, v.option2, v.option3][colorIdx] ?? null;
    const size  = sizeVal || null;
    const color = colorVal || null;

    const row = {
      submission_id:      submissionId,
      size,
      color,
      shopify_variant_id: shopifyId,
      cached_stock:       stock,
      cached_stock_at:    now,
      sku:                v.sku || null,
      price_override:     parseFloat(v.price) !== parseFloat(variants[0].price) ? parseFloat(v.price) : null,
      sort_order:         i,
      updated_at:         now,
    };

    // Upsert by shopify_variant_id
    const { data: existing } = await db
      .from('rrg_product_variants')
      .select('id')
      .eq('shopify_variant_id', shopifyId)
      .maybeSingle();

    if (existing) {
      await db.from('rrg_product_variants')
        .update({ cached_stock: stock, cached_stock_at: now, size, color, sku: row.sku, updated_at: now })
        .eq('id', existing.id);
    } else {
      row.id = randomUUID();
      row.created_at = now;
      const { error } = await db.from('rrg_product_variants').insert(row);
      if (error) console.error(`  [variant ${shopifyId}] insert error:`, error.message);
    }
  }

  console.log(`  → synced ${variants.length} variants for ${submissionId.slice(0, 8)}`);
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
  console.log(`Brand storefront: https://realrealgenuine.com/brand/${CFG.slug}`);
  for (const r of results) {
    if (r.token_id != null) console.log(`  • token #${r.token_id} → /rrg/drop/${r.token_id}`);
  }
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
