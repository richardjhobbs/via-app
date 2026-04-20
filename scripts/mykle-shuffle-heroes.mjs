/**
 * scripts/mykle-shuffle-heroes.mjs
 *
 * One-shot: pick a random aux image as the new hero for each MYKLÉ drop.
 * The flat studio shots mykle.co ships as Shopify image[0] read as product
 * records, but the lifestyle / worn / macro shots in images[1..5] are much
 * stronger. Shopify lists extras in a mostly-chronological order, so a
 * deterministic pick per product would lean on the same slot every time;
 * randomising per-product gives the storefront more visual range.
 *
 * Behaviour:
 *   - For each submission under brand slug=mykle:
 *       - Pick a random index i ∈ [0, physical_images_paths.length)
 *       - new hero        = physical_images_paths[i]
 *       - new aux array   = physical_images_paths with aux[i] replaced by old hero
 *       - Update jpeg_storage_path + physical_images_paths in one transaction
 *   - Old jpeg_filename / jpeg_size_bytes are left stale (admin-surface only,
 *     not visible on PDP; signed URLs are derived from jpeg_storage_path).
 *
 * Usage:
 *   node scripts/mykle-shuffle-heroes.mjs --dry-run
 *   node scripts/mykle-shuffle-heroes.mjs
 *   node scripts/mykle-shuffle-heroes.mjs --brand <slug>   # override target brand
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: supabase env missing'); process.exit(1); }

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i+1] || true) : null; };
const DRY_RUN = args.includes('--dry-run');
const BRAND_SLUG = flag('--brand') || 'mykle';

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

console.log(`──── Shuffle heroes: ${BRAND_SLUG} ${DRY_RUN ? '(DRY RUN)' : ''} ────`);

const { data: brand, error: bErr } = await db
  .from('rrg_brands').select('id, name').eq('slug', BRAND_SLUG).single();
if (bErr || !brand) { console.error('FATAL: brand not found:', BRAND_SLUG); process.exit(1); }

const { data: drops, error: dErr } = await db
  .from('rrg_submissions')
  .select('id, token_id, title, jpeg_storage_path, physical_images_paths')
  .eq('brand_id', brand.id).order('token_id');
if (dErr) { console.error('FATAL:', dErr); process.exit(1); }

let swapped = 0;
let skipped = 0;
for (const d of drops) {
  const aux = Array.isArray(d.physical_images_paths) ? d.physical_images_paths.slice() : [];
  if (aux.length === 0 || !d.jpeg_storage_path) {
    console.log(`skip #${d.token_id} ${d.title.slice(0, 28)}: no aux images`);
    skipped++;
    continue;
  }
  const i = Math.floor(Math.random() * aux.length);
  const newHero = aux[i];
  const oldHero = d.jpeg_storage_path;
  aux[i] = oldHero;

  console.log(`#${d.token_id} ${d.title.slice(0, 28).padEnd(28)} | picked aux[${i}] of ${d.physical_images_paths.length}`);
  console.log(`   old: ${oldHero.slice(-60)}`);
  console.log(`   new: ${newHero.slice(-60)}`);

  if (!DRY_RUN) {
    const { error } = await db.from('rrg_submissions')
      .update({ jpeg_storage_path: newHero, physical_images_paths: aux })
      .eq('id', d.id);
    if (error) { console.error(`   ERR: ${error.message}`); continue; }
  }
  swapped++;
}

console.log(`──── Done: swapped ${swapped}, skipped ${skipped} ────`);
