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
];

const HOLDING_OWNER_USER_ID = '96d37e66-d1c3-4ce3-9ccf-6e1bc99f2ea5';
const HOLDING_WALLET        = '0x61e01997e6a0c692656e94955c67cb3ebcab8f19';
const HOLDING_EMAIL         = 'richard@entrepot.asia';
const PER_PAGE_MS = 1200;  // polite delay between catalogue pages
const PER_STORE_MS = 5000; // cooldown between stores
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const j = await getJson<{ products?: ShopifyProduct[] }>(`https://${host}/products.json?limit=250&page=${page}`);
    const batch = j.products ?? [];
    all.push(...batch);
    if (batch.length < 250) break;
    await sleep(PER_PAGE_MS);
  }
  return all;
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
  const stock = p.variants?.length ? p.variants.reduce((s, x) => s + (x.available ? 1 : 0), 0) : null;
  const vinyl = parseVinylFromText({ title: p.title, body: p.body_html, tags: p.tags ?? [], vendor: p.vendor, sku: v?.sku ?? null });
  return {
    external_id: `shopify:${p.id || p.handle}`,
    kind: 'physical',
    title: p.title ?? '(untitled)',
    description: stripHtml(p.body_html).slice(0, 4000) || null,
    price_minor: Math.round(native * rate * 1_000_000),
    currency: 'USDC',
    stock,
    url: `https://${host}/products/${p.handle}`,
    metadata: { source: 'shopify', handle: p.handle, vendor: p.vendor ?? null, product_type: p.product_type ?? null, tags: p.tags ?? [], variant_count: p.variants?.length ?? 0, fx_note: fxNote, native_price: native, vinyl },
    active: (p.variants ?? []).some((x) => x.available),
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

  const products = await fetchAll(host);
  console.log(`  fetched ${products.length} products`);
  const desired = products.map((p) => buildRow(p, host, rate, fxNote)).filter((r): r is DesiredRow => r !== null);

  // existing rows for incremental compare
  const existing = new Map<string, { id: string; on_chain_status: string; fp: string }>();
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('app_seller_products').select('id, external_id, title, description, stock, metadata, active, on_chain_status').eq('seller_id', sellerId).range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const r of data) existing.set(r.external_id as string, { id: r.id as string, on_chain_status: r.on_chain_status as string, fp: fingerprint(r as never) });
    if (data.length < 1000) break;
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

  // 200-row chunks: the search_tsv generated column + GIN index make larger
  // inserts slow enough to hit Supabase's statement_timeout under load.
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await db.from('app_seller_products').insert(chunk);
    if (error) console.error(`  insert chunk @${i}: ${error.message}`); else inserted += chunk.length;
  }
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += 25) {
    await Promise.all(toUpdate.slice(i, i + 25).map(async (u) => {
      const { error } = await db.from('app_seller_products').update(u.patch).eq('id', u.id);
      if (!error) updated++;
    }));
  }
  console.log(`  ${slug}: ${inserted} inserted, ${updated} updated, ${desired.length - toInsert.length - toUpdate.length} unchanged`);
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
