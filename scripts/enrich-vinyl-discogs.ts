/**
 * scripts/enrich-vinyl-discogs.ts
 *
 * Phase 3 vinyl enrichment worker. For vinyl products whose listing data is thin
 * (no pressing_year, or never Discogs-resolved), look the release up on Discogs
 * and fill the AUTHORITATIVE pressing facts into metadata.vinyl: label,
 * catalogue_number, pressing_year, pressing_country, genres, pressing_notes, and
 * discogs_release_id (the resolved marker, so re-runs skip it).
 *
 * Listing-first: the human/listing values for media_grade, sleeve_grade,
 * condition_notes, play_tested are NEVER overwritten , Discogs fills the
 * catalogue facts, the listing keeps the condition. No images (vinyl is data,
 * not vision).
 *
 * Runs on the Box like the ingest worker. Env (from .env in cwd or environment):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCOGS_TOKEN (optional)
 *
 * Usage:
 *   node enrich-vinyl-discogs.ts                 # default batch (200)
 *   node enrich-vinyl-discogs.ts --limit 50
 *   node enrich-vinyl-discogs.ts --force         # re-resolve even if already done
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// Box bundle has discogs.ts alongside (deploy rewrites this to './discogs.ts').
import { resolveVinyl } from '../lib/app/discogs.ts';

// ── env (.env in script dir or cwd), CRLF-safe ───────────────────────
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(here, '.env'), resolve(process.cwd(), '.env')]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('[discogs-enrich] missing Supabase env'); process.exit(1); }
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const force = args.includes('--force');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Math.max(1, parseInt(args[limitArg + 1] ?? '200', 10)) : 200;
// Polite: unauth Discogs ~25/min. With a token ~60/min. Stay under either.
const DELAY_MS = process.env.DISCOGS_TOKEN ? 1100 : 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; title: string; metadata: Record<string, unknown> | null }
type Vinyl = Record<string, unknown>;

async function main() {
  // Vinyl rows that have a vinyl block but are not yet Discogs-resolved (unless --force).
  const { data, error } = await db
    .from('app_seller_products')
    .select('id, title, metadata')
    .eq('active', true)
    .eq('admin_removed', false)
    .not('metadata->vinyl', 'is', null)
    .limit(LIMIT);
  if (error) { console.error('[discogs-enrich] query failed:', error.message); process.exit(1); }

  const rows = (data ?? []) as Row[];
  let resolved = 0, skipped = 0, missed = 0;
  for (const row of rows) {
    const vinyl = (row.metadata?.vinyl ?? {}) as Vinyl;
    if (!force && typeof vinyl.discogs_release_id === 'number') { skipped++; continue; }

    const artist = (vinyl.artist as string) ?? '';
    const title = (vinyl.title as string) ?? row.title ?? '';
    const r = await resolveVinyl({
      artist,
      title,
      catalogue_number: (vinyl.catalogue_number as string) ?? null,
      barcode: (vinyl.barcode as string) ?? null,
    });
    await sleep(DELAY_MS);
    if (!r) { missed++; continue; }

    // Merge GAP-FILL ONLY: each listing is a SPECIFIC copy, so never overwrite a
    // fact the listing already states (its real pressing/country/year). Discogs
    // fills gaps + adds genres + cleans an OBVIOUSLY garbage label (parser noise
    // like "or", a duplicate, or a description blob captured as a label).
    const present = (v: unknown): boolean =>
      typeof v === 'number' ? true : typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) && v.length > 0;
    const garbageLabel = (s: unknown): boolean => {
      if (typeof s !== 'string') return true;
      const t = s.trim();
      return t.length === 0 || t.toLowerCase() === 'or' || t.length > 60 || /^(.+),\s*\1$/i.test(t);
    };
    const merged: Vinyl = {
      ...vinyl,
      discogs_release_id: r.discogs_release_id,
      label: garbageLabel(vinyl.label) ? (r.label ?? vinyl.label) : vinyl.label,
      catalogue_number: present(vinyl.catalogue_number) ? vinyl.catalogue_number : r.catalogue_number,
      pressing_year: present(vinyl.pressing_year) ? vinyl.pressing_year : r.pressing_year,
      pressing_country: present(vinyl.pressing_country) ? vinyl.pressing_country : r.pressing_country,
      genres: (r.genres && r.genres.length) ? r.genres : vinyl.genres,
      pressing_notes: present(vinyl.pressing_notes) ? vinyl.pressing_notes : r.pressing_notes,
      format: present(vinyl.format) ? vinyl.format : r.format,
    };
    const newMeta = { ...(row.metadata ?? {}), vinyl: merged };
    const { error: upErr } = await db.from('app_seller_products').update({ metadata: newMeta }).eq('id', row.id);
    if (upErr) { console.error('[discogs-enrich] update failed', row.id, upErr.message); missed++; continue; }
    resolved++;
    if (resolved % 25 === 0) console.log(`[discogs-enrich] resolved ${resolved}...`);
  }
  console.log(`[discogs-enrich] done. resolved=${resolved} skipped=${skipped} missed=${missed} of ${rows.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
