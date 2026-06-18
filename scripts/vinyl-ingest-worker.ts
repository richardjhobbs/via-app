/**
 * scripts/vinyl-ingest-worker.ts
 *
 * Scheduled vinyl catalogue ingestion worker. Designed to run on a stable host
 * (the Box) with clean egress, on a schedule. Reuses the parser from
 * lib/app/vinyl.ts (deployed alongside as ./vinyl.ts on the Box).
 *
 * For each configured store it:
 *   - upserts the app_sellers row (Stage-1 holding identity)
 *   - fetches the full Shopify catalogue, POLITELY: ~1.2s between pages,
 *     honours Retry-After, exponential backoff on 429/5xx, so it never trips
 *     Cloudflare (the failure mode that defeats a fast bulk scrape).
 *   - INCREMENTAL upsert into app_seller_products keyed on external_id:
 *     inserts new rows, updates changed ones (title/desc/price/stock/metadata),
 *     skips unchanged. Cheap to re-run, keeps catalogues fresh.
 *
 * Env (from .env in cwd or the environment):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node vinyl-ingest-worker.ts            # all configured stores
 *   node vinyl-ingest-worker.ts --only goldmine-records,atlas-records
 *   node vinyl-ingest-worker.ts --max-pages 5   # cap per store (smoke test)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// Repo path; the Box bundle has vinyl.ts alongside (deploy rewrites this to './vinyl.ts').
import { parseVinylFromText } from '../lib/app/vinyl.ts';

// ── Config ────────────────────────────────────────────────────────────
const STORES: Array<{ slug: string; url: string }> = [
  { slug: 'recycle-vinyl',     url: 'https://recycle-vinyl.co.uk' },
  { slug: 'goldmine-records',  url: 'https://www.goldminerecords.com.au' },
  { slug: 'hitman-records',    url: 'https://hitmanrecords.de' },
  { slug: 'comeback-vinyl',    url: 'https://comebackvinyl.com' },
  { slug: 'atlas-records',     url: 'https://atlasrecords.co.uk' },
  // batch 2
  { slug: 'ella-records',      url: 'https://ellarecords.jp' },
  { slug: 'cleopatra-records', url: 'https://cleorecs.com' },
  { slug: 'greville-records',  url: 'https://grevillerecords.com.au' },
  { slug: 'dear-vinyl',        url: 'https://dearvinyl.com' },
  { slug: 'brooklynvegan-store', url: 'https://shop.brooklynvegan.com' },
  // batch 3
  { slug: 'rare-vinyl',           url: 'https://www.rarevinyl.com' },
  { slug: 'taz-records',          url: 'https://taz-records.myshopify.com' },
  { slug: 'vinyleers',            url: 'https://vinyleers.de' },
  { slug: 'rocking-horse-records', url: 'https://rockinghorse.net' },
  { slug: 'snow-records',         url: 'https://www.snowrecords.com' },
  // batch 4
  { slug: 'rare-records',      url: 'https://www.rarerecords.com.au' },
  { slug: 'sold-out-vinyl',    url: 'https://soldoutvinylrecords.com' },
  { slug: 'freeson-rock',      url: 'https://freesonrock.com' },
  { slug: 'turntable-lab',     url: 'https://www.turntablelab.com' },
  { slug: 'repressed-records', url: 'https://repressedrecords.com' },
];

const HOLDING_OWNER_USER_ID = '96d37e66-d1c3-4ce3-9ccf-6e1bc99f2ea5';
const HOLDING_WALLET        = '0x61e01997e6a0c692656e94955c67cb3ebcab8f19';
const HOLDING_EMAIL         = 'richard@entrepot.asia';
const UA = 'Mozilla/5.0 (compatible; VIA-Vinyl-Ingest/1.0)';

// ── Env ───────────────────────────────────────────────────────────────
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── CLI ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n: string): string | null => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? null) : null; };
const ONLY = (flag('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_PAGES = flag('--max-pages') ? parseInt(flag('--max-pages')!, 10) : 250;
// Collections mode: crawl every collection to get past the 25k products.json
// page cap. Best-effort coverage, so it is ADDITIVE (insert/update only, no
// delete). Optional --budget caps total collection pages per store.
const COLLECTIONS_MODE = args.includes('--collections');
const COLLECTION_PAGE_BUDGET = flag('--budget') ? parseInt(flag('--budget')!, 10) : 1500;
// Pacing is configurable so the job can run gently overnight (slow base rate
// avoids tripping store WAFs). Defaults match the original fast pace.
const PER_PAGE_MS  = flag('--page-ms')  ? parseInt(flag('--page-ms')!, 10)  : 1200; // delay between catalogue pages
const PER_STORE_MS = flag('--store-ms') ? parseInt(flag('--store-ms')!, 10) : 5000; // cooldown between stores
// DB write pacing. The insert/update/delete phases write to app_seller_products,
// whose generated search_tsv + GIN index make every write IO-heavy. A full
// ingest at full speed saturated the Supabase instance and took the live site
// down (statement-timeout storm). These caps keep the write rate gentle:
//   --write-ms     pause between each write chunk (insert/delete)   default 300
//   --update-conc  concurrent UPDATEs in the update phase           default 3
const WRITE_PAUSE_MS = flag('--write-ms')    ? parseInt(flag('--write-ms')!, 10)    : 300;
const UPDATE_CONC    = flag('--update-conc') ? Math.max(1, parseInt(flag('--update-conc')!, 10)) : 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Jittered page pause: base + 0..100% random, so requests don't form a fixed
// cadence a WAF can fingerprint. Used for every catalogue/collection page.
const pagePause = () => sleep(PER_PAGE_MS + Math.floor(Math.random() * PER_PAGE_MS));

interface ShopifyVariant { price?: string; available?: boolean; sku?: string | null }
interface ShopifyProduct { id?: number; title?: string; handle?: string; body_html?: string | null; vendor?: string | null; product_type?: string | null; tags?: string[]; variants?: ShopifyVariant[] }

// ── Polite fetch with Retry-After + backoff ─────────────────────────
async function getJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': '' }, cache: 'no-store' });
    } catch (e) { lastErr = e; await sleep(3000 * (attempt + 1)); continue; }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(5000 * 2 ** attempt, 90_000);
      lastErr = new Error(`HTTP ${res.status} on ${url}`);
      console.log(`  rate-limited (${res.status}); waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return res.json() as Promise<T>;
  }
  throw lastErr ?? new Error(`failed after retries: ${url}`);
}

async function fetchAll(host: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let j: { products?: ShopifyProduct[] };
    try {
      j = await getJson<{ products?: ShopifyProduct[] }>(`https://${host}/products.json?limit=250&page=${page}`);
    } catch (e) {
      // Shopify caps page-based products.json pagination at page 100 (25,000
      // products) and returns HTTP 400 beyond it; since_id is ignored on the
      // public endpoint. Treat the 400 as end-of-catalogue and keep what we
      // have rather than failing the whole store. Stores over 25k are capped
      // at their first 25,000 (in-stock-filtered) until a collections-based
      // crawler is added.
      if (e instanceof Error && /HTTP 400/.test(e.message)) {
        console.log(`  page cap reached at page ${page}; ${all.length} products fetched (store exceeds the 25k products.json limit)`);
        break;
      }
      throw e;
    }
    const batch = j.products ?? [];
    all.push(...batch);
    if (batch.length < 250) break;
    await pagePause();
  }
  return all;
}

// ── Collections crawl (gets past the 25k products.json page cap) ─────
interface ShopifyCollection { handle?: string; title?: string; products_count?: number }

async function fetchCollections(host: string): Promise<ShopifyCollection[]> {
  const all: ShopifyCollection[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    let j: { collections?: ShopifyCollection[] };
    try {
      j = await getJson<{ collections?: ShopifyCollection[] }>(`https://${host}/collections.json?limit=250&page=${page}`);
    } catch (e) {
      if (e instanceof Error && /HTTP 400/.test(e.message)) break;
      throw e;
    }
    const batch = j.collections ?? [];
    for (const c of batch) { if (c.handle && !seen.has(c.handle)) { seen.add(c.handle); all.push(c); } }
    if (batch.length < 250) break;
    await pagePause();
  }
  return all;
}

// Union of every collection's products, deduped by product id. Crawls
// SMALLEST-first so the granular genre/decade collections (distinct products)
// are exhausted before the mega-collections (all/artists/bestsellers) that
// mostly re-yield already-seen ids. Each collection is itself page-capped at
// 100 pages by Shopify; the per-store page budget bounds total runtime.
async function fetchViaCollections(host: string): Promise<ShopifyProduct[]> {
  const cols = (await fetchCollections(host)).filter((c) => (c.products_count ?? 0) > 0);
  cols.sort((a, b) => (a.products_count ?? 0) - (b.products_count ?? 0));
  console.log(`  ${cols.length} non-empty collections; crawling smallest-first (page budget ${COLLECTION_PAGE_BUDGET})`);
  const byId = new Map<string, ShopifyProduct>();
  let pages = 0;
  let capped = false;
  for (const c of cols) {
    if (pages >= COLLECTION_PAGE_BUDGET) { capped = true; break; }
    for (let page = 1; page <= 100; page++) {
      if (pages >= COLLECTION_PAGE_BUDGET) { capped = true; break; }
      let j: { products?: ShopifyProduct[] };
      try {
        j = await getJson<{ products?: ShopifyProduct[] }>(`https://${host}/collections/${c.handle}/products.json?limit=250&page=${page}`);
      } catch (e) {
        if (e instanceof Error && /HTTP 400/.test(e.message)) break;
        throw e;
      }
      pages++;
      const batch = j.products ?? [];
      for (const p of batch) { const key = String(p.id ?? p.handle ?? ''); if (key && !byId.has(key)) byId.set(key, p); }
      if (batch.length < 250) break;
      await pagePause();
    }
  }
  console.log(`  collected ${byId.size} distinct products from ${pages} collection pages${capped ? ' (PAGE BUDGET REACHED — coverage partial)' : ''}`);
  return [...byId.values()];
}

async function usdcRate(currency: string): Promise<number> {
  if (currency === 'USD') return 1;
  const j = await getJson<{ rates?: { USD?: number } }>(`https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=USD`);
  const mkt = Number(j?.rates?.USD);
  if (!Number.isFinite(mkt) || mkt <= 0) throw new Error(`FX failed for ${currency}`);
  return mkt * 1.03; // 3% spread, matches lib/app/fx.ts
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

interface DesiredRow { external_id: string; kind: string; title: string; description: string | null; price_minor: number; currency: string; stock: number | null; url: string; metadata: Record<string, unknown>; active: boolean }

function buildRow(p: ShopifyProduct, host: string, rate: number, fxNote: string): DesiredRow | null {
  const v = p.variants?.[0];
  const native = Number(v?.price ?? '0');
  if (!Number.isFinite(native) || native < 0) return null;
  // Out-of-stock products are not ingested at all: a secondhand record with no
  // available variant has sold, and an agent can't buy it. Skip it so it never
  // enters the catalogue (resync also deletes rows that later go out of stock).
  const available = (p.variants ?? []).some((x) => x.available);
  if (!available) return null;
  const stock = p.variants?.length ? p.variants.reduce((s, x) => s + (x.available ? 1 : 0), 0) : null;
  const vinyl = parseVinylFromText({ title: p.title, body: p.body_html, tags: p.tags ?? [], vendor: p.vendor, sku: v?.sku ?? null });
  return {
    external_id: `shopify:${p.id || p.handle}`,
    kind: 'physical',
    title: p.title ?? '(untitled)',
    description: stripHtml(p.body_html).slice(0, 4000) || null,
    // Round the converted price to whole cents (2dp) so listings carry clean
    // human prices , keeps USDC's 6dp scale but zeroes the sub-cent tail
    // (e.g. 2.532745 -> 2.530000).
    price_minor: Math.round(native * rate * 100) * 10_000,
    currency: 'USDC',
    stock,
    url: `https://${host}/products/${p.handle}`,
    metadata: { source: 'shopify', handle: p.handle, vendor: p.vendor ?? null, product_type: p.product_type ?? null, tags: p.tags ?? [], variant_count: p.variants?.length ?? 0, fx_note: fxNote, native_price: native, vinyl },
    active: true,
  };
}

// Update fingerprint: the meaningful content only. Excludes volatile metadata
// (fx_note, variant_count) so daily FX drift doesn't churn every row; includes
// the vinyl block + native (source) price so real content/price changes are caught.
function fingerprint(r: { title: string; description: string | null; stock: number | null; metadata: unknown; active: boolean }): string {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  return JSON.stringify([r.title, r.description, r.stock, r.active, meta.vinyl ?? null, meta.native_price ?? null]);
}

async function ensureSeller(slug: string, host: string): Promise<string> {
  const meta = await getJson<Record<string, unknown>>(`https://${host}/meta.json`);
  const name = (meta.name as string) || host;
  const desc = meta.description ? String(meta.description).replace(/\s+/g, ' ').trim() : '';
  const currency = String(meta.currency || 'USD').toUpperCase();
  const { data: existing } = await db.from('app_sellers').select('id').eq('slug', slug).maybeSingle();
  if (existing) {
    await db.from('app_sellers').update({
      name, headline: desc.slice(0, 120) || `${name} on VIA.`, description: desc || `${name} vinyl catalogue on VIA.`,
      website_url: `https://${host}`, shopify_domain: host, catalog_source: 'shopify', source_currency: currency, updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return existing.id as string;
  }
  const { data: ins, error } = await db.from('app_sellers').insert({
    slug, name, kind: 'product', contact_email: HOLDING_EMAIL, owner_user_id: HOLDING_OWNER_USER_ID, wallet_address: HOLDING_WALLET,
    headline: desc.slice(0, 120) || `${name} on VIA.`, description: desc || `${name} vinyl catalogue on VIA.`,
    website_url: `https://${host}`, shopify_domain: host, catalog_source: 'shopify', source_currency: currency, active: true, created_via: 'vinyl_ingest_worker',
  }).select('id').single();
  if (error || !ins) throw new Error(`seller insert ${slug}: ${error?.message}`);
  return ins.id as string;
}

async function ingestStore(slug: string, url: string) {
  const host = new URL(url).host.toLowerCase();
  console.log(`\n#### ${slug} (${host}) ####`);
  const sellerId = await ensureSeller(slug, host);
  const meta = await getJson<Record<string, unknown>>(`https://${host}/meta.json`);
  const currency = String(meta.currency || 'USD').toUpperCase();
  const rate = await usdcRate(currency);
  const fxNote = `${currency}->USD x1.03 = ${rate.toFixed(6)}`;

  const products = COLLECTIONS_MODE ? await fetchViaCollections(host) : await fetchAll(host);
  console.log(`  fetched ${products.length} products`);
  const desired = products.map((p) => buildRow(p, host, rate, fxNote)).filter((r): r is DesiredRow => r !== null);

  // existing rows for incremental compare. Order by EXTERNAL_ID, not id: the
  // partial unique index (seller_id, external_id) WHERE external_id IS NOT NULL
  // gives an index-ordered scan (stable pagination, no sort). Ordering by id has
  // no supporting index here and forces a sort/heap-scan that times out on the
  // 100k+ row table. The `external_id IS NOT NULL` filter is what lets the
  // planner use that partial index; every worker-written row has an external_id.
  // PAGE 500 keeps each response under the statement timeout. CRUCIAL: an
  // errored page ABORTS the store — never treat null as "no existing rows", or
  // every product goes to insert, collides on the unique index, and nothing
  // lands (the 0-inserted/0-updated/0-unchanged failure mode).
  const existing = new Map<string, { id: string; on_chain_status: string; fp: string }>();
  const PAGE = 500;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await db.from('app_seller_products').select('id, external_id, title, description, stock, metadata, active, on_chain_status').eq('seller_id', sellerId).not('external_id', 'is', null).order('external_id', { ascending: true }).range(off, off + PAGE - 1);
    if (error) throw new Error(`existing-load @${off}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) existing.set(r.external_id as string, { id: r.id as string, on_chain_status: r.on_chain_status as string, fp: fingerprint(r as never) });
    if (data.length < PAGE) break;
  }

  const toInsert: Array<DesiredRow & { seller_id: string }> = [];
  const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const d of desired) {
    const ex = existing.get(d.external_id);
    if (!ex) { toInsert.push({ ...d, seller_id: sellerId }); continue; }
    const fp = fingerprint(d);
    if (fp !== ex.fp) {
      const patch: Record<string, unknown> = { title: d.title, description: d.description, stock: d.stock, metadata: d.metadata, active: d.active, updated_at: new Date().toISOString() };
      if (ex.on_chain_status === 'draft') patch.price_minor = d.price_minor; // price immutable once registered
      toUpdate.push({ id: ex.id, patch });
    }
  }

  // Out-of-stock / delisted reconciliation: any existing draft whose external_id
  // is no longer in `desired` has sold or been removed (out-of-stock products
  // are skipped at build time), so delete it — we neither ingest nor keep
  // out-of-stock listings. Only DRAFT rows are deletable; a registered/minted
  // row keeps its on-chain record. Guard on desired.length so a transiently
  // empty fetch can never wipe the catalogue.
  // Collections mode is ADDITIVE: `desired` is a best-effort, budget-capped
  // union, NOT the full catalogue, so a row missing from it does not mean
  // out-of-stock. Never delete in that mode (would drop valid in-stock rows
  // simply not reached this crawl). Page-based mode has complete coverage, so
  // it reconciles deletions normally.
  const desiredIds = new Set(desired.map((d) => d.external_id));
  const toDelete = (!COLLECTIONS_MODE && desired.length > 0)
    ? [...existing.entries()].filter(([ext, ex]) => !desiredIds.has(ext) && ex.on_chain_status === 'draft').map(([, ex]) => ex.id)
    : [];

  // Collapse in-run duplicates: a product can appear on two Shopify pages if the
  // catalogue shifts mid-fetch, which would collide on (seller_id, external_id).
  const seenExt = new Set<string>();
  const uniqueInserts = toInsert.filter((r) => {
    if (seenExt.has(r.external_id)) return false;
    seenExt.add(r.external_id);
    return true;
  });

  // Plain insert in 200-row chunks (larger chunks hit Supabase's
  // statement_timeout via the search_tsv generated column + GIN index). The
  // unique index on (seller_id, external_id) is PARTIAL (WHERE external_id IS
  // NOT NULL), so PostgREST upsert/ON CONFLICT cannot infer it. Instead, if a
  // chunk hits a stray duplicate the dedup map missed, fall back to per-row
  // inserts so one collision never drops the rest of the chunk.
  let inserted = 0;
  for (let i = 0; i < uniqueInserts.length; i += 200) {
    const chunk = uniqueInserts.slice(i, i + 200);
    const { error } = await db.from('app_seller_products').insert(chunk);
    if (!error) {
      inserted += chunk.length;
    } else {
      for (const row of chunk) {
        const { error: rowErr } = await db.from('app_seller_products').insert(row);
        if (!rowErr) inserted++;
        else if (!/duplicate key/i.test(rowErr.message)) console.error(`  insert row ${row.external_id}: ${rowErr.message}`);
      }
    }
    // Pause between insert chunks so the GIN index + checkpointer keep up. This
    // is the change that stops a full ingest from saturating the DB.
    if (i + 200 < uniqueInserts.length) await sleep(WRITE_PAUSE_MS);
  }
  // Concurrency 6 + a short inter-batch pause: the update phase can run many
  // thousands of round-trips per store, and at 25-wide with no pause it
  // saturated the shared PostgREST/PgBouncer pool, starving the live site's
  // landing-stats count (which then dropped the local catalogue from the
  // headline). 6-wide leaves pool headroom for the app.
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += UPDATE_CONC) {
    await Promise.all(toUpdate.slice(i, i + UPDATE_CONC).map(async (u) => {
      const { error } = await db.from('app_seller_products').update(u.patch).eq('id', u.id);
      if (!error) updated++;
    }));
    await sleep(WRITE_PAUSE_MS);
  }

  // Delete the sold/delisted drafts in id batches.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const batch = toDelete.slice(i, i + 200);
    const { error } = await db.from('app_seller_products').delete().in('id', batch);
    if (error) console.error(`  delete batch @${i}: ${error.message}`); else deleted += batch.length;
    await sleep(WRITE_PAUSE_MS);
  }

  // Refresh the cached per-seller product count. The admin reads
  // app_sellers.product_count instead of counting live (a count over the
  // 200k-row catalogue times out / saturates the pool). One index-only count
  // via (seller_id, external_id) here keeps that cache fresh after every sync.
  const { count: finalCount } = await db.from('app_seller_products')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId).not('external_id', 'is', null).eq('admin_removed', false);
  if (typeof finalCount === 'number') {
    await db.from('app_sellers').update({ product_count: finalCount, product_count_at: new Date().toISOString() }).eq('id', sellerId);
  }

  console.log(`  ${slug}: ${inserted} inserted, ${updated} updated, ${deleted} deleted (out of stock), ${desired.length - toInsert.length - toUpdate.length} unchanged${typeof finalCount === 'number' ? ` (catalogue ${finalCount})` : ''}`);
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  const stores = ONLY.length ? STORES.filter((s) => ONLY.includes(s.slug)) : STORES;
  console.log(`Vinyl ingest worker: ${stores.length} store(s) @ ${new Date().toISOString()}`);
  for (const s of stores) {
    try { await ingestStore(s.slug, s.url); }
    catch (e) { console.error(`  ${s.slug} FAILED: ${e instanceof Error ? e.message : String(e)}`); }
    await sleep(PER_STORE_MS);
  }
  console.log('\nDONE');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
