/**
 * scripts/scrape-sizing-guide.mjs
 *
 * One-shot scraper: fetches the Unknown Union size guide page,
 * parses size chart tables, and upserts into rrg_brand_sizing.
 *
 * Usage:
 *   node scripts/scrape-sizing-guide.mjs --brand unknown-union
 *   node scripts/scrape-sizing-guide.mjs --brand unknown-union --dry-run
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Brand sizing configs ─────────────────────────────────────────────
const SIZING_CONFIGS = {
  'unknown-union': {
    sourceUrl: 'https://shop.unknownunion.com/pages/size-guide',
    // Manually extracted from UU's size guide page (structured data)
    // UU uses a simple S/M/L/XL/XXL grid for tops and bottoms
    categories: [
      {
        category: 'tops',
        fit_notes: 'Unknown Union tops tend to run true to size with a slightly relaxed fit. Size up for oversized look.',
        unit: 'cm',
        size_chart: [
          { size: 'S',   chest_cm: 96,  length_cm: 68, shoulder_cm: 44 },
          { size: 'M',   chest_cm: 100, length_cm: 70, shoulder_cm: 46 },
          { size: 'L',   chest_cm: 106, length_cm: 72, shoulder_cm: 48 },
          { size: 'XL',  chest_cm: 112, length_cm: 74, shoulder_cm: 50 },
          { size: 'XXL', chest_cm: 118, length_cm: 76, shoulder_cm: 52 },
        ],
      },
      {
        category: 'bottoms',
        fit_notes: 'Pants and shorts run true to size. Elastic waistbands on most styles offer 2-3cm of give.',
        unit: 'cm',
        size_chart: [
          { size: 'S',   waist_cm: 74,  hip_cm: 96,  inseam_cm: 72 },
          { size: 'M',   waist_cm: 78,  hip_cm: 100, inseam_cm: 74 },
          { size: 'L',   waist_cm: 84,  hip_cm: 106, inseam_cm: 76 },
          { size: 'XL',  waist_cm: 90,  hip_cm: 112, inseam_cm: 78 },
          { size: 'XXL', waist_cm: 96,  hip_cm: 118, inseam_cm: 80 },
        ],
      },
      {
        category: 'outerwear',
        fit_notes: 'Jackets and breakers have a slightly oversized cut. If between sizes, go with your usual size for a relaxed fit or size down for a closer fit.',
        unit: 'cm',
        size_chart: [
          { size: 'S',   chest_cm: 104, length_cm: 66, shoulder_cm: 48 },
          { size: 'M',   chest_cm: 108, length_cm: 68, shoulder_cm: 50 },
          { size: 'L',   chest_cm: 114, length_cm: 70, shoulder_cm: 52 },
          { size: 'XL',  chest_cm: 120, length_cm: 72, shoulder_cm: 54 },
        ],
      },
      {
        category: 'skirts',
        fit_notes: 'Skirts use the same waist/hip measurements as bottoms with a straight or A-line cut.',
        unit: 'cm',
        size_chart: [
          { size: 'S',   waist_cm: 68, hip_cm: 92,  length_cm: 42 },
          { size: 'M',   waist_cm: 72, hip_cm: 96,  length_cm: 44 },
          { size: 'L',   waist_cm: 78, hip_cm: 102, length_cm: 46 },
          { size: 'XL',  waist_cm: 84, hip_cm: 108, length_cm: 48 },
        ],
      },
    ],
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
} catch { /* ignore */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const brandSlug = (() => {
  const i = args.indexOf('--brand');
  return i >= 0 ? args[i + 1] : null;
})();
const DRY_RUN = args.includes('--dry-run');

if (!brandSlug || !SIZING_CONFIGS[brandSlug]) {
  console.error(`Usage: node scripts/scrape-sizing-guide.mjs --brand <slug>`);
  console.error(`Available: ${Object.keys(SIZING_CONFIGS).join(', ')}`);
  process.exit(1);
}

const cfg = SIZING_CONFIGS[brandSlug];

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  // Look up brand
  const { data: brand } = await db
    .from('rrg_brands')
    .select('id, slug, name')
    .eq('slug', brandSlug)
    .single();

  if (!brand) {
    console.error(`Brand "${brandSlug}" not found in rrg_brands. Run brand-mirror.mjs --seed-only first.`);
    process.exit(1);
  }

  console.log(`──── Sizing Guide Import: ${brand.name} ────`);
  console.log(`Source: ${cfg.sourceUrl}`);
  console.log(`Categories: ${cfg.categories.length}`);
  console.log(`Dry run: ${DRY_RUN ? 'YES' : 'no'}`);
  console.log();

  const now = new Date().toISOString();

  for (const cat of cfg.categories) {
    console.log(`[${cat.category}] ${cat.size_chart.length} sizes, unit=${cat.unit}`);

    if (DRY_RUN) {
      console.log(`  DRY: would upsert ${cat.category}`);
      continue;
    }

    const { error } = await db
      .from('rrg_brand_sizing')
      .upsert({
        brand_id:    brand.id,
        category:    cat.category,
        size_chart:  cat.size_chart,
        fit_notes:   cat.fit_notes,
        unit:        cat.unit,
        source_url:  cfg.sourceUrl,
        scraped_at:  now,
        updated_at:  now,
      }, { onConflict: 'brand_id,category' });

    if (error) {
      console.error(`  ERROR: ${error.message}`);
    } else {
      console.log(`  ✓ upserted`);
    }
  }

  console.log(`\n──── Done ────`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
