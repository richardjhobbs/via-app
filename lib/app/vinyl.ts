/**
 * lib/app/vinyl.ts
 *
 * VIA vinyl-records category. A vinyl listing is an ordinary
 * app_seller_products row (kind='physical', pricing_mode='fixed') with a
 * `vinyl` object inside the existing metadata jsonb. No migration; the vinyl
 * block is a metadata convention. See docs/reference_via_vinyl_schema.md.
 *
 * Single source of truth for:
 *   - the Goldmine grade scale and its normalisation
 *   - best-effort extraction of a vinyl block from a Shopify product
 *   - building a vinyl block from CSV row cells
 *   - sanitising seller-supplied vinyl input (dashboard edit)
 *   - the publish-time gate (media + sleeve grade required)
 */

import type { ShopifyProduct } from '../shopify/products-json';

/** Goldmine condition scale, best (M) to worst (P). */
export const VINYL_GRADES = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'] as const;
export type VinylGrade = (typeof VINYL_GRADES)[number];

export interface VinylBlock {
  artist?:             string;
  title?:              string;
  format?:             string;   // "LP", "12\"", "7\"", "2xLP", etc.
  label?:              string;
  catalogue_number?:   string;
  pressing_country?:   string;
  pressing_year?:      number;
  media_grade?:        VinylGrade;
  sleeve_grade?:       VinylGrade;
  condition_notes?:    string;
  play_tested?:        boolean;
  matrix_runout?:      string;
  discogs_release_id?: number;   // reserved; seller-entered for now, resolver is phase 2
}

// Goldmine grades plus the common synonyms sellers actually write. Discogs
// treats "M-" as Near Mint, so it folds into NM.
const GRADE_SYNONYMS: Record<string, VinylGrade> = {
  'M': 'M', 'MINT': 'M',
  'NM': 'NM', 'M-': 'NM', 'NEAR MINT': 'NM',
  'VG+': 'VG+', 'VG PLUS': 'VG+', 'VERY GOOD PLUS': 'VG+',
  'VG': 'VG', 'VERY GOOD': 'VG',
  'G+': 'G+', 'GOOD PLUS': 'G+',
  'G': 'G', 'GOOD': 'G',
  'F': 'F', 'FAIR': 'F',
  'P': 'P', 'POOR': 'P',
};

export function normaliseGrade(raw: string | null | undefined): VinylGrade | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  return GRADE_SYNONYMS[key] ?? null;
}

export function isVinylGrade(x: unknown): x is VinylGrade {
  return typeof x === 'string' && (VINYL_GRADES as readonly string[]).includes(x);
}

// ── Shopify best-effort parse ────────────────────────────────────────
//
// Used-vinyl Shopify stores commonly encode format, condition, and the
// catalogue number in the product title, tags, and variant SKU. This parse
// is deliberately conservative: it sets only what it can read with
// confidence and leaves the rest for the seller to complete (via CSV or the
// dashboard). A vinyl listing missing its grades will not pass the publish
// gate, which is the intended backstop.

const FORMAT_RE = /(\d+\s*[x×]\s*)?(LP|12"|10"|7"|EP)/i;
// Longer tokens first so "VG+" wins over "VG", "G+" over "G", "M-" over "M".
const GRADE_TOKEN = 'M-|NM|VG\\+|VG|G\\+|G|MINT|NEAR ?MINT|EX|M|F|P';
const GRADE_PAIR_RE = new RegExp(`(${GRADE_TOKEN})\\s*/\\s*(${GRADE_TOKEN})`, 'i');

export function parseShopifyVinyl(p: ShopifyProduct): VinylBlock {
  const v: VinylBlock = {};
  const title = (p.title ?? '').trim();
  const tags  = Array.isArray(p.tags) ? p.tags : [];
  const hay   = [title, ...tags].join(' ');

  // Artist / record title from a "Artist - Title" product title.
  const dash = title.match(/^(.+?)\s[-–]\s(.+)$/);
  if (dash) {
    v.artist = dash[1].trim();
    v.title  = dash[2].trim();
  }

  const fm = hay.match(FORMAT_RE);
  if (fm) v.format = fm[0].replace(/\s+/g, '').replace('×', 'x').replace(/lp$/i, 'LP').replace(/ep$/i, 'EP');

  // A media/sleeve grade pair, e.g. "VG+/VG".
  const gp = hay.match(GRADE_PAIR_RE);
  if (gp) {
    const media  = normaliseGrade(gp[1]);
    const sleeve = normaliseGrade(gp[2]);
    if (media)  v.media_grade  = media;
    if (sleeve) v.sleeve_grade = sleeve;
  } else {
    // Many dealers list a single overall (record) grade at the end of the
    // title, e.g. "Artist - Title (SF PROG) VG+". Capture it as the media
    // grade; the sleeve grade stays unset for the seller to complete.
    const single = title.trim().match(new RegExp(`(?:^|[\\s)])(${GRADE_TOKEN})\\s*$`, 'i'));
    const g = single ? normaliseGrade(single[1]) : null;
    if (g) {
      v.media_grade = g;
      // Strip the trailing grade (and any "(shelf code)" before it) from the
      // parsed record title so it reads cleanly.
      if (v.title) {
        v.title = v.title.replace(new RegExp(`(?:\\s*\\([^)]*\\))?\\s*(?:${GRADE_TOKEN})\\s*$`, 'i'), '').trim() || v.title;
      }
    }
  }

  // Vinyl stores commonly set the variant SKU to the catalogue number.
  const sku = p.variants?.[0]?.sku?.trim();
  if (sku) v.catalogue_number = sku;

  if (p.vendor) v.label = p.vendor.trim();

  return v;
}

// ── CSV row parse ────────────────────────────────────────────────────
//
// Optional vinyl columns on the standard sync-csv schema. Builds a block
// only when at least one vinyl column is populated, so non-vinyl uploads
// are untouched. Grade validation happens in csv-import validateRows; this
// just maps recognised values through.

export function vinylFromCsvRow(values: Record<string, string>): VinylBlock | null {
  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const val = (values[k] ?? '').trim();
      if (val) return val;
    }
    return '';
  };
  const block: VinylBlock = {};

  const artist = get('artist');                              if (artist) block.artist = artist;
  const vtitle = get('vinyl_title', 'record_title');         if (vtitle) block.title = vtitle;
  const format = get('format');                              if (format) block.format = format;
  const label  = get('label');                               if (label)  block.label = label;
  const cat    = get('catalogue_number', 'catalog_number', 'cat_no', 'catno', 'barcode');
  if (cat) block.catalogue_number = cat;
  const country = get('pressing_country', 'country');        if (country) block.pressing_country = country;

  const yearRaw = get('pressing_year', 'year');
  if (yearRaw) {
    const y = parseInt(yearRaw.replace(/[^0-9]/g, ''), 10);
    if (Number.isInteger(y) && y > 0) block.pressing_year = y;
  }

  const media  = normaliseGrade(get('media_grade', 'media'));   if (media)  block.media_grade = media;
  const sleeve = normaliseGrade(get('sleeve_grade', 'sleeve')); if (sleeve) block.sleeve_grade = sleeve;

  const notes  = get('condition_notes', 'notes');  if (notes)  block.condition_notes = notes.slice(0, 2000);
  const matrix = get('matrix_runout', 'matrix');   if (matrix) block.matrix_runout = matrix;

  const pt = get('play_tested').toLowerCase();
  if (pt) block.play_tested = ['true', 'yes', 'y', '1'].includes(pt);

  const did = get('discogs_release_id', 'discogs_id');
  if (did) {
    const n = parseInt(did.replace(/[^0-9]/g, ''), 10);
    if (Number.isInteger(n) && n > 0) block.discogs_release_id = n;
  }

  return Object.keys(block).length > 0 ? block : null;
}

// ── Seller-supplied input (dashboard edit) ───────────────────────────
//
// Validates and normalises a vinyl object posted by the seller so they can
// complete the grades the import could not parse. Grades that are present
// but unrecognised are rejected; everything else is best-effort coerced.

export function sanitiseVinylInput(
  input: unknown,
): { ok: true; vinyl: VinylBlock } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'vinyl must be an object' };
  const inp = input as Record<string, unknown>;
  const out: VinylBlock = {};

  const strFields: Array<keyof VinylBlock> = [
    'artist', 'title', 'format', 'label', 'catalogue_number',
    'pressing_country', 'condition_notes', 'matrix_runout',
  ];
  for (const k of strFields) {
    const raw = inp[k];
    if (typeof raw === 'string' && raw.trim()) {
      const val = raw.trim();
      (out as Record<string, unknown>)[k] = k === 'condition_notes' ? val.slice(0, 2000) : val;
    }
  }

  if (inp.pressing_year !== undefined && inp.pressing_year !== null && String(inp.pressing_year).trim() !== '') {
    const y = Number(inp.pressing_year);
    if (Number.isInteger(y) && y > 0) out.pressing_year = y;
  }
  if (inp.discogs_release_id !== undefined && inp.discogs_release_id !== null && String(inp.discogs_release_id).trim() !== '') {
    const n = Number(inp.discogs_release_id);
    if (Number.isInteger(n) && n > 0) out.discogs_release_id = n;
  }
  if (inp.play_tested !== undefined) out.play_tested = Boolean(inp.play_tested);

  for (const key of ['media_grade', 'sleeve_grade'] as const) {
    const raw = inp[key];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const g = normaliseGrade(String(raw));
      if (!g) return { ok: false, error: `${key} "${String(raw)}" is not a recognised grade (${VINYL_GRADES.join(', ')}).` };
      out[key] = g;
    }
  }

  return { ok: true, vinyl: out };
}

// ── Publish gate ─────────────────────────────────────────────────────
//
// Called from publishProduct with metadata.vinyl. A row with no vinyl block
// is not a vinyl listing and passes untouched. A vinyl listing must carry a
// valid media_grade (the record grade, which governs playability) before it
// can be minted on-chain. sleeve_grade is optional: most 12"/DJ dealers grade
// the record only and ship generic sleeves, so an absent sleeve grade is
// surfaced to buyers as "not specified" rather than blocking the listing. A
// sleeve_grade that IS present must still be a valid grade.

export function validateVinylForPublish(
  vinyl: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!vinyl || typeof vinyl !== 'object') return { ok: true };
  const v = vinyl as Record<string, unknown>;
  if (!isVinylGrade(v.media_grade)) {
    return {
      ok: false,
      error: `Vinyl listings require a valid media_grade (Goldmine scale: ${VINYL_GRADES.join(', ')}) before publishing.`,
    };
  }
  if (v.sleeve_grade !== undefined && v.sleeve_grade !== null && v.sleeve_grade !== '' && !isVinylGrade(v.sleeve_grade)) {
    return {
      ok: false,
      error: `sleeve_grade "${String(v.sleeve_grade)}" is not a recognised grade (Goldmine scale: ${VINYL_GRADES.join(', ')}). Leave it blank if the sleeve is not graded.`,
    };
  }
  return { ok: true };
}
