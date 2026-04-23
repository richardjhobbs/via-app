/**
 * One-shot: reconcile Stadium Goods Alaska variant stock with real availability
 * scraped from the product page HTML. SG's /products/{handle}.json hides
 * availability; /products.json exposes it but is rate-limited. The product page
 * HTML embeds the same variant JSON with `available` booleans — this script
 * reads a local copy and updates cached_stock on rrg_product_variants.
 *
 * Usage:
 *   node scripts/fix-sg-alaska-stock.mjs --token 302 --html-file /path/to/page.html
 *
 * cached_stock convention: 1 if available, 0 if sold out. SG doesn't expose
 * real counts on the storefront; rationing the mirror to "available / not"
 * matches what buyers see on stadiumgoods.com.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i+1] : null; };
const TOKEN_ID = parseInt(flag('--token'), 10);
const HTML_FILE = flag('--html-file');
if (!TOKEN_ID || !HTML_FILE) {
  console.error('Usage: node scripts/fix-sg-alaska-stock.mjs --token <N> --html-file <path>');
  process.exit(1);
}

// Load .env.local
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) { const k = m[1].trim(); const v = m[2].trim().replace(/^["']|["']$/g, ''); if (!process.env[k]) process.env[k] = v; }
  }
} catch { console.error('FATAL: cannot read .env.local'); process.exit(1); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Extract variant availability from product page HTML. Shopify themes embed
// product JSON with `available: true|false` per variant.
const html = readFileSync(HTML_FILE, 'utf8');
// eslint-disable-next-line no-control-regex
const re = /"id":(\d+),"title":"([^"]+)","option1":"([^"]+)"[^}]*"available":(true|false)/g;
const avail = new Map();
let m;
while ((m = re.exec(html)) !== null) {
  avail.set(m[1], { size: m[3], available: m[4] === 'true' });
}
if (avail.size === 0) { console.error('No variants extracted from HTML'); process.exit(1); }
console.log(`Parsed ${avail.size} variants from HTML`);

// Resolve submission via token_id
const { data: sub, error: se } = await db.from('rrg_submissions').select('id').eq('token_id', TOKEN_ID).single();
if (se || !sub) { console.error(`token ${TOKEN_ID} not found:`, se?.message); process.exit(1); }

const { data: variants, error: ve } = await db.from('rrg_product_variants').select('id, size, shopify_variant_id, cached_stock').eq('submission_id', sub.id);
if (ve) { console.error('variants fetch error:', ve.message); process.exit(1); }
console.log(`DB has ${variants.length} variants for submission ${sub.id.slice(0,8)}`);

const now = new Date().toISOString();
let updated = 0, unchanged = 0;
for (const v of variants) {
  const a = avail.get(String(v.shopify_variant_id));
  if (!a) { console.warn(`  [skip] no HTML match for shopify_variant_id=${v.shopify_variant_id} size=${v.size}`); continue; }
  const newStock = a.available ? 1 : 0;
  if (v.cached_stock === newStock) { unchanged++; continue; }
  const { error } = await db.from('rrg_product_variants').update({ cached_stock: newStock, cached_stock_at: now, updated_at: now }).eq('id', v.id);
  if (error) { console.error(`  [err] size ${v.size}:`, error.message); continue; }
  console.log(`  [upd] size ${String(v.size).padEnd(4)} ${v.cached_stock} → ${newStock}`);
  updated++;
}

// Recompute edition_size (total available stock across sizes)
const totalAvail = Array.from(avail.values()).filter(a => a.available).length;
const { error: eErr } = await db.from('rrg_submissions').update({ edition_size: totalAvail }).eq('id', sub.id);
if (eErr) console.error('edition_size update failed:', eErr.message);
else console.log(`edition_size → ${totalAvail}`);

console.log(`\nDone: ${updated} updated, ${unchanged} unchanged`);
