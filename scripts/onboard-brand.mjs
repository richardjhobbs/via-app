/**
 * scripts/onboard-brand.mjs
 *
 * STAGE 1 brand onboarding orchestrator. One command turns a Shopify URL
 * into a hidden-but-seeded RRG brand mirror, ready for in-session
 * enhancement by Claude (which then flips hidden=false).
 *
 *   node scripts/onboard-brand.mjs --url https://shop.example.com [--slug example] [--count 8] [--guidance "..."] [--dry-run]
 *
 * What it does:
 *   1. Fetches <host>/meta.json to read shop name, currency, country.
 *   2. Fetches <host>/products.json (paginated) and picks the first --count
 *      products. Optional --guidance is recorded in the config for the
 *      operator to apply during enhancement.
 *   3. Looks up live FX from frankfurter.app to derive priceToUsdcRate
 *      (USD-base brands skip FX, rate=1).
 *   4. Synthesizes a BRANDS-shaped config object: slug, name, headline,
 *      description, shopifyDomain, sourceCurrency, priceToUsdcRate, plus
 *      Richard's holding wallet + email as first-seed temp holders.
 *   5. Writes the config to tmp/onboard-<slug>-<ts>.json.
 *   6. Spawns brand-mirror.mjs --config <path> as a subprocess. brand-mirror
 *      seeds the brand row (status=active, merchant_type=direct_brand by
 *      default), imports up to --count products with hidden=true, prints
 *      the operator next-steps for in-session enhancement.
 *   7. Prints a summary with the storefront URL and the list of token IDs
 *      that need enhancement.
 *
 * What it does NOT do:
 *   - On-chain registerDrop (pass-through to brand-mirror requires
 *     --commit-chain. This orchestrator deliberately omits it; chain
 *     registration belongs to confirm-brand.mjs after the brand confirms.
 *   - Sizing-guide scrape (garment brands still need scrape-sizing-guide.mjs
 *     hand-config; non-garment defaults are fine).
 *   - Enhancement (per feedback_enhancement_done_in_session.md, that step
 *     is performed by Claude in-session, not by an API-key-driven script).
 */

import { spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ── Constants ────────────────────────────────────────────────────────
// Holding wallet + admin email used as first-seed temp holders for any
// brand onboarded by this orchestrator. ensureBrand() in brand-mirror.mjs
// does NOT overwrite these on update once the row exists, so swapping
// them per brand happens later via confirm-brand.mjs (or direct DB edit).
// Source: scripts/brand-mirror.mjs header block (lines 34-46).
const HOLDING_WALLET = '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7';
const HOLDING_EMAIL  = 'richard@entrepot.asia';

// USDC is pegged 1:1 to USD on Base. Other currencies need a live FX
// conversion factor so Shopify base-currency prices map to USDC at
// import time. Frankfurter.app is key-free and covers the majors used
// by current brands (verified 2026-04-30: HKD, AUD, JPY, SGD, GBP, EUR,
// USD, NOK, ZAR all present).
const FX_API = 'https://api.frankfurter.app/latest';

// ── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};

const URL_IN     = flag('--url');
const SLUG_IN    = flag('--slug');
const COUNT_IN   = flag('--count');
const GUIDANCE   = flag('--guidance');
const DRY_RUN    = args.includes('--dry-run');
const NO_SPAWN   = args.includes('--no-spawn'); // emit config only, do not run brand-mirror

if (!URL_IN || typeof URL_IN !== 'string') {
  console.error('Usage: node scripts/onboard-brand.mjs --url <url> [--slug <slug>] [--count <n>] [--guidance "..."] [--dry-run] [--no-spawn]');
  process.exit(1);
}

const COUNT = COUNT_IN ? Math.max(1, parseInt(String(COUNT_IN), 10)) : 10;

// ── Helpers ──────────────────────────────────────────────────────────
function deriveSlug(host) {
  // shop.unknownunion.com → unknown-union
  // wearenolo.com → wearenolo (caller can override with --slug)
  let h = host.replace(/^www\./, '').replace(/^shop\./, '').replace(/^store\./, '');
  // strip TLD
  const parts = h.split('.');
  const base = parts.length > 1 ? parts.slice(0, -1).join('-') : h;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':      'RRG-Onboarder/1.0',
      'Accept':          'application/json',
      'Accept-Language': '', // force shop base currency, see brand-mirror.mjs note
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

async function fetchMeta(host) {
  // Shopify exposes /meta.json on every shop with shop name, currency,
  // country, description. Verified shape on shop.unknownunion.com:
  //   { id, name, city, province, country, currency, domain, description }
  return getJson(`https://${host}/meta.json`);
}

async function fetchProducts(host, want) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://${host}/products.json?limit=250&page=${page}`;
    const json = await getJson(url);
    const batch = json.products ?? [];
    all.push(...batch);
    if (batch.length < 250) break;
    if (all.length >= want * 4) break; // be polite, we only need first N
  }
  return all;
}

async function fetchFxToUsd(currency) {
  if (currency === 'USD') return 1;
  const url = `${FX_API}?from=${encodeURIComponent(currency)}&to=USD`;
  const json = await getJson(url);
  const rate = json?.rates?.USD;
  if (!Number.isFinite(rate)) throw new Error(`FX lookup failed for ${currency}: ${JSON.stringify(json)}`);
  return rate;
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  const u = new URL(URL_IN.startsWith('http') ? URL_IN : `https://${URL_IN}`);
  const host = u.host.toLowerCase();

  console.log(`──── Onboard Brand ────`);
  console.log(`URL:      https://${host}`);

  // 1. Probe meta.json to confirm Shopify and read currency/name
  let meta;
  try {
    meta = await fetchMeta(host);
  } catch (e) {
    console.error(`FATAL: could not read https://${host}/meta.json. Is this a Shopify store?`);
    console.error(`       ${e.message}`);
    console.error(`       Non-Shopify catalogues need a manual BRANDS entry in scripts/brand-mirror.mjs.`);
    process.exit(1);
  }

  const shopCurrency = String(meta.currency || 'USD').toUpperCase();
  const shopName     = meta.name || host;
  const shopDesc     = meta.description ? String(meta.description).replace(/\s+/g, ' ').trim() : '';

  const slug = (typeof SLUG_IN === 'string' ? SLUG_IN : deriveSlug(host)).toLowerCase();
  console.log(`Shop:     ${shopName} (${meta.country || 'unknown country'}, base currency ${shopCurrency})`);
  console.log(`Slug:     ${slug}`);

  // 2. Fetch products, take first N
  const products = await fetchProducts(host, COUNT);
  console.log(`Catalogue: ${products.length} products fetched, picking first ${COUNT}`);
  if (products.length === 0) {
    console.error(`FATAL: ${host} returned zero products from /products.json`);
    process.exit(1);
  }
  const picked = products.slice(0, COUNT);
  const handles = picked.map(p => p.handle);

  // 3. FX
  const usdRate = await fetchFxToUsd(shopCurrency);
  // priceToUsdcRate: Shopify price * priceToUsdcRate = USDC. USDC == USD on Base.
  const priceToUsdcRate = Number(usdRate.toFixed(6));
  console.log(`FX:       1 ${shopCurrency} = ${priceToUsdcRate} USDC (frankfurter.app, ${new Date().toISOString().slice(0,10)})`);

  // 4. Synthesize BRANDS-shaped config
  const cfg = {
    slug,
    name: shopName,
    wallet: HOLDING_WALLET,
    email:  HOLDING_EMAIL,
    headline: shopDesc.slice(0, 120) || `${shopName} on Real Real Genuine.`,
    description: (shopDesc || `${shopName} catalogue mirror.`)
      + ` Mirror of ${host} on Real Real Genuine. Checkout in USDC on Base.`,
    website:        `https://${host}`,
    shopifyDomain:  host,
    sourcePlatform: 'shopify',
    sourceCurrency: shopCurrency === 'USD' ? undefined : shopCurrency,
    priceToUsdcRate,
    fxAsOf:         new Date().toISOString().slice(0, 10),
    socialLinks:    {},
    merchantType:   'direct_brand',
    supportsSizing: false,
    onboardedBy:    'scripts/onboard-brand.mjs',
    onboardedAt:    new Date().toISOString(),
    pickedHandles:  handles,
    guidance:       typeof GUIDANCE === 'string' ? GUIDANCE : null,
  };

  // 5. Write tmp config
  const tmpDir = resolve(process.cwd(), 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const cfgPath = resolve(tmpDir, `onboard-${slug}-${ts}.json`);
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log(`Config:   ${cfgPath}`);
  console.log();

  if (DRY_RUN) {
    console.log('[dry-run] config written, brand-mirror NOT spawned');
    return;
  }
  if (NO_SPAWN) {
    console.log('[--no-spawn] config written, brand-mirror NOT spawned');
    console.log(`Run manually: node scripts/brand-mirror.mjs --config ${cfgPath} --handles ${handles.join(',')}`);
    return;
  }

  // 6. Spawn brand-mirror with --config + --handles to scope the run
  console.log(`──── Spawning brand-mirror ────`);
  const childArgs = [
    'scripts/brand-mirror.mjs',
    '--config', cfgPath,
    '--handles', handles.join(','),
  ];
  const result = spawnSync('node', childArgs, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    console.error(`FATAL: brand-mirror exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  // 7. Summary
  console.log();
  console.log(`──── Stage 1 complete ────`);
  console.log(`Storefront:    https://realrealgenuine.com/brand/${slug}`);
  console.log(`Per-brand MCP: https://realrealgenuine.com/brand/${slug}/mcp`);
  console.log(`Config saved:  ${cfgPath}`);
  console.log();
  console.log(`Operator reminder (show to user):`);
  console.log(`  Add brand logo and main image in /admin/rrg Brands tab.`);
  console.log();
  console.log(`Claude must now do these without asking permission (single-instruction rule):`);
  console.log(`  1. Enhance every hidden product in this batch (write enhanced_description + product_attributes per row), then flip hidden=false.`);
  console.log(`  2. Create the Notion Integration page for ${slug} by duplicating the most recent "RRG x ...: Agent Commerce Integration" page`);
  console.log(`     (e.g. HoMie 352dbc7b67f2817cb9dac0b256bbd52b) under parent 34ddbc7b67f2809bb287c81c4493ba7f ("Brand Integration"),`);
  console.log(`     then customise the brand name, slug, currency, FX, products table, and storefront link.`);
  console.log(`  3. Reply with the Notion page URL so the user can forward it to the brand.`);
  console.log(`  Do NOT pause to ask "shall I draft this?" or "want me to create this?" — the script printing this block is the instruction.`);
  console.log();
  console.log(`Then Stage 2 (after brand confirms):`);
  console.log(`  node scripts/confirm-brand.mjs --slug ${slug} --admin-email <email> [--shopify-token <tok>]`);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
