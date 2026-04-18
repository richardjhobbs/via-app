/**
 * scripts/brand-mirror.mjs
 *
 * Generalized Shopify-to-RRG mirror. Config-driven from a JSON block per brand.
 * Unlike clooudie-mirror.mjs, this imports ALL variants per product (size/color)
 * into rrg_product_variants and supports garment brands with sizing.
 *
 * Usage:
 *   node scripts/brand-mirror.mjs --brand unknown-union                  # DB + images only (safe default)
 *   node scripts/brand-mirror.mjs --brand unknown-union --commit-chain   # DB + images + registerDrop on Base
 *   node scripts/brand-mirror.mjs --brand unknown-union --only seven-society-rugby-shirt
 *   node scripts/brand-mirror.mjs --brand unknown-union --dry-run
 *   node scripts/brand-mirror.mjs --brand unknown-union --seed-only
 *
 * Chain registration is OPT-IN since April 2026. Running without --commit-chain
 * will upload images and seed rrg_submissions / rrg_product_variants but will
 * NOT call registerDrop on the RRG contract. The on-chain step is a deliberate
 * commitment (costs gas + makes the drop publicly addressable) and must be
 * requested explicitly. `--skip-chain` remains accepted as a no-op alias.
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
  'frey-tailored': {
    slug:            'frey-tailored',
    name:            'Frey Tailored',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Savile Row techniques, made for her.',
    description:     'Frey Tailored — a Hong Kong womenswear label specialising in tailoring. Half canvas construction, surgeon\u2019s cuffs, satin peak lapels and jetted pockets applied to contemporary feminine silhouettes. Mirror of frey-tailored.com — checkout in USDC on Base, ships from Frey HK.',
    website:         'https://frey-tailored.com',
    shopifyDomain:   'frey-tailored.com',
    supportsSizing:  true,
    // HKD is USD-pegged (7.75-7.85 band since 1983). Lock a fixed rate for
    // the mirror run; drift is ~0.1%. Documented in Notion Phase 22 entry.
    sourceCurrency:  'HKD',
    priceToUsdcRate: 1 / 7.78, // locked 2026-04-16
    socialLinks:     { instagram: 'https://www.instagram.com/frey.tailored/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'passport-adv': {
    slug:            'passport-adv',
    name:            'PassportADV',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Footwear and apparel from Addis to LA.',
    description:     'PassportADV — Ethiopian-inflected streetwear and technical apparel designed out of Los Angeles. Mirror of passportadv.com — checkout in USDC on Base, ships from PassportADV.',
    website:         'https://www.passportadv.com',
    sourcePlatform:  'squarespace',
    squarespaceShopUrl: 'https://www.passportadv.com/shop-1',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'bobby-joseph': {
    slug:            'bobby-joseph',
    name:            'BOBBYJOSEPH',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Uniquely designed, out of Los Angeles.',
    description:     'BOBBYJOSEPH: an assortment of uniquely designed goods out of Los Angeles. Limited-edition teddy bear charms, graphic-printed t-shirts and hoodies, headwear and single-speed bikes. Mirror of bobbyjoseph.com, checkout in USDC on Base, ships from BOBBYJOSEPH LA.',
    website:         'https://bobbyjoseph.com',
    shopifyDomain:   'bobbyjoseph.com',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'university-of-diversity': {
    slug:            'university-of-diversity',
    name:            'University of Diversity',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Many backgrounds. One campus.',
    description:     'University of Diversity \u2014 collegiate-inflected apparel built around a single Arch Seal that stands for a shared campus across every background. Mirror of universityofdiversity.myshopify.com, checkout in USDC on Base, ships from UoD.',
    website:         'https://universityofdiversity.myshopify.com',
    shopifyDomain:   'universityofdiversity.myshopify.com',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'mykle': {
    slug:            'mykle',
    name:            'MYKLÉ',
    // MYKLÉ brand agent, wallet minted 2026-04-18, ERC-8004 agent #45112
    wallet:          '0x9eb5405feF682E1d4d555f64a683A499076556a3',
    email:           'richard@entrepot.asia',
    headline:        'Precision. Emotion. Silk as language.',
    description:     'MYKL\u00c9 \u2014 silk scarves and ties by Norwegian designer Torunn Myklebust. Heritage florals, rope motifs and damier patterns rendered in silk, built for longevity over season. Mirror of mykle.co, checkout in USDC on Base, ships from MYKL\u00c9 France.',
    website:         'https://mykle.co',
    shopifyDomain:   'mykle.co',
    supportsSizing:  false,
    sourceCurrency:  'EUR',
    priceToUsdcRate: 1.18, // locked 2026-04-18, 1 EUR = $1.18 USDC
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'nolo': {
    slug:            'nolo',
    name:            'Nolo',
    // Nolo brand agent, wallet minted 2026-04-17, ERC-8004 agent #45040
    wallet:          '0x891C13aA323378637404EfD971553A3a6df5aAf1',
    email:           'richard@entrepot.asia',
    headline:        'Decaf cold brew oat lattes, without the compromise.',
    description:     'Nolo is a UK decaf cold brew oat latte brand. Classic, Caramel Swirl, and a Decaf Double Bundle, sold by the pack. Mirror of wearenolo.com, checkout in USDC on Base, ships from Nolo UK.',
    website:         'https://wearenolo.com',
    shopifyDomain:   'wearenolo.com',
    supportsSizing:  true, // pack-count ("12 Cans"/"24 Cans"/"36 Cans") imported as size variants
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.27, // locked 2026-04-17, 1 GBP = $1.27 USDC
    socialLinks:     { instagram: 'https://www.instagram.com/wearenolo/' },
    bannerLocal:     null,
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
// Chain registration is now OPT-IN (safer default for pilots, onboarding
// agents, and re-runs). Pass --commit-chain to actually call registerDrop on
// Base mainnet. `--skip-chain` is still accepted as a no-op alias.
const COMMIT_CHAIN = args.includes('--commit-chain');
const SKIP_CHAIN   = !COMMIT_CHAIN; // inverted — chain is skipped unless explicitly committed
if (args.includes('--skip-chain') && COMMIT_CHAIN) {
  console.error('FATAL: cannot pass both --skip-chain and --commit-chain');
  process.exit(1);
}

if (!BRAND_KEY || !BRANDS[BRAND_KEY]) {
  console.error(`Usage: node scripts/brand-mirror.mjs --brand <slug>`);
  console.error(`Available: ${Object.keys(BRANDS).join(', ')}`);
  process.exit(1);
}

const CFG = BRANDS[BRAND_KEY];
const handleFilter = ONLY
  ? new Set([ONLY])
  : (HANDLES ? new Set(String(HANDLES).split(',').map(h => h.trim()).filter(Boolean)) : null);

const PLATFORM = CFG.sourcePlatform || 'shopify';
if (PLATFORM === 'shopify' && !CFG.shopifyDomain) {
  console.error('FATAL: shopify brand missing shopifyDomain'); process.exit(1);
}
if (PLATFORM === 'squarespace' && !CFG.squarespaceShopUrl) {
  console.error('FATAL: squarespace brand missing squarespaceShopUrl'); process.exit(1);
}

console.log(`──── Brand Mirror: ${CFG.name} ────`);
console.log(`Platform:  ${PLATFORM}`);
console.log(`Source:    ${PLATFORM === 'shopify' ? CFG.shopifyDomain : CFG.squarespaceShopUrl}`);
console.log(`Sizing:    ${CFG.supportsSizing ? 'YES' : 'no'}`);
console.log(`Dry run:   ${DRY_RUN ? 'YES' : 'no'}`);
console.log(`Chain:     ${SKIP_CHAIN ? 'SKIP (pass --commit-chain to register on-chain)' : 'COMMIT (on-chain registerDrop enabled)'}`);
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
      console.log('[seed] DRY: would insert brand row — continuing with in-memory stub');
      return {
        id: '00000000-0000-0000-0000-000000000000',
        slug: CFG.slug,
        name: CFG.name,
        self_listings_used: 0,
      };
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
  // Shopify caps products.json at 250 per page; walk pages until the response
  // is short (end of catalogue) or a safety cap is hit.
  //
  // NB: Shopify's multi-currency routing will return localised prices if the
  // request carries an Accept-Language header (Node's fetch adds a default).
  // We force Accept-Language: "" so Shopify serves the shop's BASE currency
  // (the one defined in the Shopify admin) — that's what CFG.priceToUsdcRate
  // expects when converting to USDC.
  const MAX_PAGES = 10; // up to 2,500 products — generous for any single brand
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${CFG.shopifyDomain}/products.json?limit=250&page=${page}`;
    console.log(`[shopify] GET ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'RRG-Mirror/2.0',
        'Accept':          'application/json',
        'Accept-Language': '', // critical — see note above
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Shopify ${res.status} on page ${page}`);
    const json = await res.json();
    const batch = json.products ?? [];
    all.push(...batch);
    if (batch.length < 250) break; // last page
  }
  console.log(`[shopify] received ${all.length} products (across pages)`);
  return all;
}

/**
 * Fetch from Squarespace `?format=json` and normalize to the Shopify-compatible
 * shape the rest of this script consumes (product.variants[].option1/2/3,
 * product.options[], product.images[].src, etc).
 *
 * Squarespace's JSON endpoint is undocumented but stable — see
 * lib/squarespace/products-json.ts for notes.
 */
async function fetchSquarespace() {
  const parseShopUrl = (u) => {
    const url = new URL(u);
    return { origin: url.origin, path: url.pathname.replace(/\/$/, '') };
  };
  const { origin, path } = parseShopUrl(CFG.squarespaceShopUrl);

  const all = [];
  let offset;
  for (let page = 0; page < 20; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const offsetPart = offset ? `&offset=${offset}` : '';
    const url = `${origin}${path}${sep}format=json${offsetPart}`;
    console.log(`[squarespace] GET ${url}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RRG-Mirror/2.0', 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Squarespace ${res.status} on ${url}`);
    const data = await res.json();
    const items = data.items ?? [];

    for (const item of items) {
      const sqsVariants = item.structuredContent?.variants ?? [];

      // Derive option schema from the union of variant attribute keys, in the
      // order Squarespace provides via variantOptionOrdering (if present).
      const ordering = item.structuredContent?.variantOptionOrdering
        ?? (sqsVariants[0]?.attributes ? Object.keys(sqsVariants[0].attributes) : []);
      const options = ordering.map((name) => ({ name }));

      const variants = sqsVariants.map((v, idx) => {
        const attrs = v.attributes ?? {};
        const opts = ordering.map((k) => attrs[k] ?? null);
        return {
          id: v.id, // Squarespace UUID string
          title: Object.values(attrs).join(' / ') || 'Default',
          price: (v.price / 100).toFixed(2),
          compare_at_price: null,
          sku: v.sku || null,
          available: v.unlimited || (v.qtyInStock > 0),
          // For `unlimited: true` Squarespace variants, treat stock as unknown
          // and let getTotalStock() fall back to counting available variants
          // (1 unit each). Using qtyInStock verbatim when a finite cap is set.
          inventory_quantity: v.unlimited ? 0 : (v.qtyInStock ?? 0),
          position: idx + 1,
          option1: opts[0] ?? null,
          option2: opts[1] ?? null,
          option3: opts[2] ?? null,
        };
      });

      // Single-variant fallback so `product.variants[0]` always exists.
      if (variants.length === 0) {
        variants.push({
          id: `${item.id}-default`,
          title: 'Default',
          price: ((item.structuredContent?.priceCents ?? item.priceCents ?? 0) / 100).toFixed(2),
          compare_at_price: null,
          sku: null,
          available: true,
          inventory_quantity: 1,
          position: 1,
          option1: null, option2: null, option3: null,
        });
      }

      const imageList = (item.items ?? []).filter(i => i.assetUrl);
      const images = imageList.length
        ? imageList
            .slice()
            .sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0))
            .map((img, idx) => ({ id: img.id, src: img.assetUrl, position: idx + 1 }))
        : item.assetUrl
          ? [{ id: item.id, src: item.assetUrl, position: 1 }]
          : [];

      all.push({
        id: item.id,
        title: item.title,
        handle: item.urlId,
        // Squarespace product URLs aren't `/products/<handle>` — keep the real path.
        sourceUrl: `${origin}${item.fullUrl}`,
        body_html: item.body ?? item.excerpt ?? null,
        vendor: null,
        product_type: null,
        tags: item.tags ?? [],
        options,
        variants,
        images,
      });
    }

    if (!data.pagination?.nextPage || !data.pagination?.nextPageOffset) break;
    offset = data.pagination.nextPageOffset;
  }
  console.log(`[squarespace] received ${all.length} products`);
  return all;
}

async function fetchProducts() {
  return PLATFORM === 'squarespace' ? fetchSquarespace() : fetchShopify();
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

// Supabase upload cap we've observed in practice (~5MB). Shopify hi-res source
// PNGs regularly breach that, so cap width and fall back progressively if the
// payload still comes back too big. Only applies to Shopify CDN URLs (they
// accept ?width= as a resize param); other hosts pass through unchanged.
const MAX_IMAGE_BYTES = 5_000_000;
const SHOPIFY_WIDTHS  = [2000, 1600, 1200];

function withShopifyWidth(url, width) {
  if (!/cdn\.shopify\.com/.test(url)) return url;
  const u = new URL(url);
  u.searchParams.set('width', String(width));
  return u.toString();
}

async function downloadImage(url) {
  const candidates = /cdn\.shopify\.com/.test(url)
    ? [url, ...SHOPIFY_WIDTHS.map(w => withShopifyWidth(url, w))]
    : [url];

  let lastBuf = null;
  for (const u of candidates) {
    const res = await fetch(u, { headers: { 'User-Agent': 'RRG-Mirror/2.0' } });
    if (!res.ok) throw new Error(`image ${u} → ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    lastBuf = buf;
    if (buf.length <= MAX_IMAGE_BYTES) return buf;
    console.log(`  [img] ${buf.length} bytes > cap, retrying smaller variant`);
  }
  // All candidates too big — return the smallest (last) and let upload fail loud
  return lastBuf;
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

  // Convert shop-currency price → USDC (1:1 for USD brands, scaled for HKD etc.)
  const rawPrice = parseFloat(variant.price);
  const rate     = Number.isFinite(CFG.priceToUsdcRate) && CFG.priceToUsdcRate > 0 ? CFG.priceToUsdcRate : 1;
  const price    = Math.round(rawPrice * rate * 100) / 100;
  if (!Number.isFinite(price) || price < 0.01 || price > 5000) {
    console.warn(`[skip ${handle}] price out of range: ${variant.price} ${CFG.sourceCurrency ?? 'USD'} → ${price} USDC`);
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

  // Download + upload hero image
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

  // Upload up to 5 additional product images for the PPD modal gallery.
  // Shopify `product.images` includes the hero as images[0] — skip it.
  const EXTRA_IMAGE_CAP = 5;
  const physicalImagesPaths = [];
  const extraImages = (product.images ?? []).slice(1, 1 + EXTRA_IMAGE_CAP);
  for (let i = 0; i < extraImages.length; i++) {
    const extra = extraImages[i];
    try {
      const buf = await downloadImage(extra.src);
      const f   = detectImage(buf);
      if (!f) { console.warn(`  [extra-img ${i+1}] not jpeg/png/webp, skipping`); continue; }
      const fn  = `${CFG.slug}-${handle}-aux-${i+1}-${Date.now()}.${f.ext}`;
      const p   = `submissions/${submissionId}/jpeg/${fn}`;
      const { error: e } = await db.storage.from(BUCKET).upload(p, buf, {
        contentType: f.mime, upsert: false,
      });
      if (e) { console.warn(`  [extra-img ${i+1}] upload failed: ${e.message}`); continue; }
      physicalImagesPaths.push(p);
    } catch (err) {
      console.warn(`  [extra-img ${i+1}] error: ${err.message}`);
    }
  }
  if (physicalImagesPaths.length > 0) {
    console.log(`  [extra-imgs] uploaded ${physicalImagesPaths.length} additional image(s)`);
  }

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
    physical_images_paths: physicalImagesPaths.length > 0 ? physicalImagesPaths : null,
    ecommerce_url:       product.sourceUrl
                          ?? `https://${CFG.shopifyDomain}/products/${handle}`,
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
      price_override:     (() => {
        if (parseFloat(v.price) === parseFloat(variants[0].price)) return null;
        const r = Number.isFinite(CFG.priceToUsdcRate) && CFG.priceToUsdcRate > 0 ? CFG.priceToUsdcRate : 1;
        return Math.round(parseFloat(v.price) * r * 100) / 100;
      })(),
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

  const products = await fetchProducts();
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
