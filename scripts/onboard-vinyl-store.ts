/**
 * scripts/onboard-vinyl-store.ts
 *
 * STAGE 1 vinyl-store onboarding for VIA (the app_sellers / app_seller_products
 * surface, NOT RRG). One command turns a vinyl dealer's public Shopify URL into
 * a VIA seller plus a catalogue of draft listings, each carrying the
 * metadata.vinyl block (see docs/reference_via_vinyl_schema.md). No images, no
 * vision enhancement: VIA is data-only.
 *
 *   node --experimental-strip-types scripts/onboard-vinyl-store.ts \
 *     --url https://recycle-vinyl.co.uk [--slug recycle-vinyl] [--count 200] [--dry-run]
 *
 * What it does:
 *   1. Reads <host>/meta.json (shop name, base currency, country, description).
 *   2. Reads <host>/products.json (paginated) and takes the first --count
 *      products (default: the whole catalogue).
 *   3. Resolves the USDC FX rate via the same lib/app/fx.ts the sync routes use.
 *   4. Upserts the app_sellers row (kind='product', active=true) on the Stage-1
 *      holding identity: operator owner_user_id + holding wallet + a non-test
 *      holding email so a later publish mints for real. These three are
 *      replaced at Stage 2 (confirm) with the merchant's real wallet + email +
 *      ERC-8004 identity. An existing seller row keeps its holding fields.
 *   5. Upserts each product into app_seller_products keyed (seller_id,
 *      external_id='shopify:<id>') so a later /sync-shopify?category=vinyl run
 *      updates the same rows. parseShopifyVinyl fills metadata.vinyl from the
 *      title / tags / SKU. Rows land on_chain_status='draft'.
 *   6. Prints the per-seller MCP URL, how many listings are publish-ready
 *      (both grades parsed) vs need grades, and the next steps.
 *
 * What it does NOT do (Stage 2, separate):
 *   - Real wallet provisioning + ERC-8004 registration (confirm step).
 *   - publishProduct / on-chain registerDrop. Drafts are not minted here.
 *   - Any image handling.
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL and a service-role key
 * (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getUsdcRate, priceToUsdcMinor } from '../lib/app/fx.ts';
import { stripHtml, type ShopifyProduct } from '../lib/shopify/products-json.ts';
import { parseShopifyVinyl, isVinylGrade } from '../lib/app/vinyl.ts';

// ── Stage-1 holding identity ──────────────────────────────────────────
// Operator-owned placeholders, mirroring the RRG holding-wallet pattern.
// Verified against the live via-agent-mcp DB: the same owner + wallet that
// seed-created stores (arc-lights, demo-printer) already use. The email is
// deliberately NOT a +test/+e2e alias (see lib/app/test-mode.ts) so a Stage-2
// publish performs a real on-chain mint. Stage 2 (confirm) swaps all three for
// the merchant's own wallet, email, and ERC-8004 identity.
const HOLDING_OWNER_USER_ID = '96d37e66-d1c3-4ce3-9ccf-6e1bc99f2ea5';
const HOLDING_WALLET        = '0x61e01997e6a0c692656e94955c67cb3ebcab8f19';
const HOLDING_EMAIL         = 'richard@entrepot.asia';

const APP_BASE = 'https://app.getvia.xyz';

// ── Env ───────────────────────────────────────────────────────────────
function loadEnvLocal() {
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
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: missing NEXT_PUBLIC_SUPABASE_URL or service-role key in .env.local');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── CLI ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string): string | true | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};
const URL_IN   = flag('--url');
const SLUG_IN   = flag('--slug');
const COUNT_IN  = flag('--count');
const SAMPLE_IN = flag('--sample');
const DRY_RUN   = args.includes('--dry-run');

if (!URL_IN || typeof URL_IN !== 'string') {
  console.error('Usage: node --experimental-strip-types scripts/onboard-vinyl-store.ts --url <url> [--slug <slug>] [--count <n> | --sample <n>] [--dry-run]');
  process.exit(1);
}
const COUNT  = typeof COUNT_IN === 'string' ? Math.max(1, parseInt(COUNT_IN, 10)) : Infinity;
// --sample N imports N random products from a wide pool (controlled test runs);
// --count N (or neither) takes the first N (or the whole catalogue).
const SAMPLE = typeof SAMPLE_IN === 'string' ? Math.max(1, parseInt(SAMPLE_IN, 10)) : null;

// ── Helpers ───────────────────────────────────────────────────────────
function deriveSlug(host: string): string {
  const h = host.replace(/^www\./, '').replace(/^shop\./, '').replace(/^store\./, '');
  const parts = h.split('.');
  const base = parts.length > 1 ? parts.slice(0, -1).join('-') : h;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries transient failures (429 + 5xx + network) with increasing backoff so a
// large catalogue fetch survives Shopify/Cloudflare rate limiting. Fails fast
// on permanent 4xx (e.g. 404 = not a Shopify store).
async function getJson<T = unknown>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VIA-Vinyl-Onboarder/1.0)', 'Accept': 'application/json', 'Accept-Language': '' },
        cache: 'no-store',
      });
    } catch (e) { lastErr = e; await sleep(1500 * (attempt + 1)); continue; }
    if (res.status === 429 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status} on ${url}`); await sleep(2500 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return res.json() as Promise<T>;
  }
  throw lastErr ?? new Error(`failed after retries: ${url}`);
}

async function fetchProducts(host: string, want: number): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; page <= 250; page++) {
    const json = await getJson<{ products?: ShopifyProduct[] }>(`https://${host}/products.json?limit=250&page=${page}`);
    const batch: ShopifyProduct[] = json.products ?? [];
    all.push(...batch);
    if (batch.length < 250) break;
    if (all.length >= want) break;
    await new Promise((r) => setTimeout(r, 250)); // politeness between pages
  }
  return all;
}

function totalStock(p: ShopifyProduct): number | null {
  if (!p.variants || p.variants.length === 0) return null;
  return p.variants.reduce((sum, v) => sum + (v.available ? 1 : 0), 0);
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  const u = new URL(URL_IN.startsWith('http') ? URL_IN : `https://${URL_IN}`);
  const host = u.host.toLowerCase();

  console.log('──── Onboard Vinyl Store (VIA Stage 1) ────');
  console.log(`URL:      https://${host}`);

  let meta: Record<string, unknown>;
  try {
    meta = await getJson<Record<string, unknown>>(`https://${host}/meta.json`);
  } catch (e) {
    console.error(`FATAL: could not read https://${host}/meta.json. Is this a public Shopify store?`);
    console.error(`       ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const shopCurrency = String(meta.currency || 'USD').toUpperCase();
  const shopName     = meta.name || host;
  const shopDesc     = meta.description ? String(meta.description).replace(/\s+/g, ' ').trim() : '';
  const slug = (typeof SLUG_IN === 'string' ? SLUG_IN : deriveSlug(host)).toLowerCase();

  console.log(`Shop:     ${shopName} (${meta.country || 'unknown'}, base ${shopCurrency})`);
  console.log(`Slug:     ${slug}`);

  let picked: ShopifyProduct[];
  if (SAMPLE) {
    const pool = await fetchProducts(host, Math.max(SAMPLE * 25, 1250));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    picked = pool.slice(0, SAMPLE);
    console.log(`Catalogue: ${pool.length} fetched, randomly sampled ${picked.length}`);
  } else {
    const products = await fetchProducts(host, COUNT === Infinity ? Number.MAX_SAFE_INTEGER : COUNT);
    picked = COUNT === Infinity ? products : products.slice(0, COUNT);
    console.log(`Catalogue: ${products.length} fetched, importing ${picked.length}`);
  }
  if (picked.length === 0) {
    console.error(`FATAL: ${host} returned zero products from /products.json`);
    process.exit(1);
  }

  const fx = await getUsdcRate(shopCurrency);
  console.log(`FX:       ${fx.note}`);

  // ── Upsert the seller (Stage-1 holding identity) ───────────────────
  const { data: existing } = await db
    .from('app_sellers')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();

  let sellerId: string;
  if (existing) {
    sellerId = existing.id;
    console.log(`Seller:   exists id=${sellerId}, updating storefront fields (holding wallet/email/owner untouched)`);
    if (!DRY_RUN) {
      const { error } = await db.from('app_sellers').update({
        name:            shopName,
        headline:        shopDesc.slice(0, 120) || `${shopName} on VIA.`,
        description:     shopDesc || `${shopName} vinyl catalogue on VIA.`,
        website_url:     `https://${host}`,
        shopify_domain:  host,
        catalog_source:  'shopify',
        source_currency: shopCurrency,
        updated_at:      new Date().toISOString(),
      }).eq('id', sellerId);
      if (error) { console.error(`FATAL: seller update: ${error.message}`); process.exit(1); }
    }
  } else {
    if (DRY_RUN) {
      sellerId = '(dry-run-seller-id)';
      console.log(`Seller:   DRY would insert app_sellers slug=${slug}`);
    } else {
      const { data: inserted, error } = await db.from('app_sellers').insert({
        slug,
        name:            shopName,
        kind:            'product',
        contact_email:   HOLDING_EMAIL,
        owner_user_id:   HOLDING_OWNER_USER_ID,
        wallet_address:  HOLDING_WALLET,
        headline:        shopDesc.slice(0, 120) || `${shopName} on VIA.`,
        description:     shopDesc || `${shopName} vinyl catalogue on VIA.`,
        website_url:     `https://${host}`,
        shopify_domain:  host,
        catalog_source:  'shopify',
        source_currency: shopCurrency,
        active:          true,
        created_via:     'operator_vinyl_onboard',
      }).select('id').single();
      if (error || !inserted) { console.error(`FATAL: seller insert: ${error?.message}`); process.exit(1); }
      sellerId = inserted.id;
      console.log(`Seller:   created id=${sellerId}`);
    }
  }

  // ── Import products as draft vinyl listings (chunked insert) ────────
  // First-load operator tool: build every row, then plain-insert in chunks.
  // The (seller_id, external_id) unique index is PARTIAL, so PostgREST upsert
  // can't use it; instead we refuse to bulk-load a seller that already has
  // products (a re-load would duplicate). Incremental, merge-preserving
  // re-sync is the route path (POST /sync-shopify?category=vinyl).
  let synced = 0, skipped = 0, publishReady = 0, needGrades = 0;
  const errors: string[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const p of picked) {
    const firstVariant = p.variants?.[0];
    if (!firstVariant) { skipped++; continue; }
    const nativePrice = Number(firstVariant.price ?? '0');
    if (!Number.isFinite(nativePrice) || nativePrice < 0) {
      skipped++; errors.push(`${p.title}: invalid price ${firstVariant.price}`); continue;
    }
    const vinyl = parseShopifyVinyl(p);
    if (isVinylGrade(vinyl.media_grade)) publishReady++;
    else needGrades++;
    rows.push({
      seller_id:   sellerId,
      external_id: `shopify:${p.id || p.handle}`,
      kind:        'physical',
      title:       p.title,
      description: stripHtml(p.body_html).slice(0, 4000) || null,
      price_minor: priceToUsdcMinor(nativePrice, fx.rate),
      currency:    'USDC',
      stock:       totalStock(p),
      url:         `https://${host}/products/${p.handle}`,
      metadata: {
        source: 'shopify', handle: p.handle, vendor: p.vendor ?? null,
        product_type: p.product_type ?? null, tags: p.tags ?? [],
        variant_count: p.variants.length, fx_note: fx.note,
        native_price: nativePrice, vinyl,
      },
      active: p.variants.some((v) => v.available),
    });
  }

  let alreadyPresent = 0;
  if (DRY_RUN) {
    synced = rows.length;
  } else {
    // Dedup against rows already on this seller so a re-run / balance-load only
    // inserts NEW products. The (seller_id, external_id) unique index is
    // partial, so PostgREST upsert can't use it; we filter instead.
    const existingIds = new Set<string>();
    for (let off = 0; ; off += 1000) {
      const { data: ex } = await db
        .from('app_seller_products')
        .select('external_id')
        .eq('seller_id', sellerId)
        .range(off, off + 999);
      if (!ex || ex.length === 0) break;
      for (const e of ex) if (e.external_id) existingIds.add(e.external_id as string);
      if (ex.length < 1000) break;
    }
    const fresh = rows.filter((r) => !existingIds.has(r.external_id as string));
    alreadyPresent = rows.length - fresh.length;
    if (alreadyPresent) console.log(`  ${alreadyPresent} already present, inserting ${fresh.length} new`);
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500);
      const { error } = await db.from('app_seller_products').insert(chunk);
      if (error) errors.push(`insert chunk @${i} (${chunk.length}): ${error.message}`);
      else synced += chunk.length;
      console.log(`  inserted ${Math.min(i + 500, fresh.length)}/${fresh.length}`);
    }
  }

  console.log();
  console.log('──── Stage 1 complete ────');
  console.log(`Seller MCP:    ${APP_BASE}/sellers/${slug}/mcp`);
  console.log(`Imported:      ${synced} inserted, ${alreadyPresent} already present, ${skipped} skipped`);
  console.log(`Publish-ready: ${publishReady} (media grade parsed), ${needGrades} need a media grade before they can publish`);
  if (errors.length) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
  }
  console.log();
  console.log('Next:');
  console.log(`  1. Create the Notion integration doc for ${slug} under "Vinyl Store Integration Docs"`);
  console.log(`     (page 37ddbc7b67f2800fbe7de38af9749113), mirroring the RRG integration pages.`);
  console.log(`  2. Listings that need a media grade: complete media_grade (CSV re-upload or dashboard)`);
  console.log(`     before they can be published. sleeve_grade is optional. The publish gate enforces this.`);
  console.log(`  3. Stage 2 (after the dealer confirms): swap the holding wallet/email/owner for the dealer's`);
  console.log(`     own, register ERC-8004 identity, then publish the graded listings on-chain.`);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
