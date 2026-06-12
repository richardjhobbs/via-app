/**
 * lib/app/vinyl.ts
 *
 * VIA vinyl-records category. A vinyl listing is an ordinary
 * app_seller_products row (kind='physical', pricing_mode='fixed') with a
 * `vinyl` object inside the existing metadata jsonb. No migration; the vinyl
 * block is a metadata convention. See docs/reference_via_vinyl_schema.md.
 *
 * VIA has no product images, so the integrity of the item TEXT is everything:
 * agent buyers in this market are detail/provenance obsessives. This module is
 * the extraction engine that turns a dealer's free-form listing (title, tags,
 * vendor, body) into a rich structured vinyl block: artist, record title,
 * format, label, genres, catalogue number, country, year, condition (media +
 * sleeve, plus the raw condition note), matrix/runout, barcode, and pressing
 * notes. It is multi-format and multi-language because every dealer writes
 * differently (recycle-vinyl, Hitman's "Vinyl NM | Cover NM" + German labels,
 * Goldmine's "Condition: New/Sealed/Mint"). Missing fields never block a sale;
 * they just give the buyer's agent less to go on.
 */

import type { ShopifyProduct } from '../shopify/products-json';

// Local, dependency-free HTML strip (mirrors lib/shopify/products-json
// stripHtml). Inline so this module imports only a TYPE from that file.
function stripHtmlText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Goldmine condition scale, best (M) to worst (P). */
export const VINYL_GRADES = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'] as const;
export type VinylGrade = (typeof VINYL_GRADES)[number];

export interface VinylBlock {
  artist?:             string;
  title?:              string;
  format?:             string;   // "LP", "12\"", "7\"", "2xLP", "2x12\"", etc.
  label?:              string;
  genres?:             string[];
  catalogue_number?:   string;
  pressing_country?:   string;
  pressing_year?:      number;
  media_grade?:        VinylGrade;  // mapped to Goldmine when the dealer's wording maps cleanly
  sleeve_grade?:       VinylGrade;
  condition_notes?:    string;       // the dealer's raw condition wording, always kept verbatim
  pressing_notes?:     string[];     // reissue / original / 180g / gatefold / promo / mono ...
  barcode?:            string;
  play_tested?:        boolean;
  matrix_runout?:      string;
  discogs_release_id?: number;       // reserved; resolver is phase 2
}

// Goldmine grades + the wordings dealers actually write, including "new/sealed"
// (a sealed copy is Mint) and Discogs' "M-" (folds to NM). Anything we cannot
// map to a Goldmine grade is still kept verbatim in condition_notes, so no
// information is lost.
const GRADE_SYNONYMS: Record<string, VinylGrade> = {
  'M': 'M', 'MINT': 'M', 'NEW': 'M', 'SEALED': 'M', 'BRAND NEW': 'M',
  'NEW/SEALED': 'M', 'SEALED/MINT': 'M', 'NEW/SEALED/MINT': 'M', 'NEW & SEALED': 'M', 'STILL SEALED': 'M',
  'NM': 'NM', 'M-': 'NM', 'MINT-': 'NM', 'NEAR MINT': 'NM', 'NEAR-MINT': 'NM',
  'VG+': 'VG+', 'VG++': 'VG+', 'VG PLUS': 'VG+', 'VERY GOOD PLUS': 'VG+',
  'VG': 'VG', 'VERY GOOD': 'VG',
  'G+': 'G+', 'GOOD PLUS': 'G+',
  'G': 'G', 'GOOD': 'G',
  'F': 'F', 'FAIR': 'F',
  'P': 'P', 'POOR': 'P',
};

export function normaliseGrade(raw: string | null | undefined): VinylGrade | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/\s+/g, ' ').replace(/[.,;]+$/, '');
  return GRADE_SYNONYMS[key] ?? null;
}

export function isVinylGrade(x: unknown): x is VinylGrade {
  return typeof x === 'string' && (VINYL_GRADES as readonly string[]).includes(x);
}

const GRADE_TOKEN = 'M-|NM|VG\\+\\+?|VG|G\\+|G|MINT|NEAR ?MINT|SEALED|NEW|EX|M|F|P';
const GRADE_PAIR_RE = new RegExp(`(${GRADE_TOKEN})\\s*/\\s*(${GRADE_TOKEN})`, 'i');

/** Coerce a free-text condition phrase to a Goldmine grade, else null. */
function coerceGrade(raw: string | null | undefined): VinylGrade | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase().replace(/\s+/g, ' ').replace(/[.,;]+$/, '');
  if (GRADE_SYNONYMS[t]) return GRADE_SYNONYMS[t];
  const paren = t.match(/\(([^)]+)\)/);
  if (paren) { const g = coerceGrade(paren[1]); if (g) return g; }
  // longest word-phrases first so "NEAR MINT" beats "MINT", "VERY GOOD PLUS" beats "VERY GOOD"
  for (const phrase of ['NEW/SEALED/MINT', 'STILL SEALED', 'BRAND NEW', 'NEAR MINT', 'VERY GOOD PLUS', 'VERY GOOD', 'GOOD PLUS', 'SEALED', 'MINT', 'NEW', 'GOOD', 'FAIR', 'POOR']) {
    if (t.includes(phrase)) return GRADE_SYNONYMS[phrase];
  }
  const tok = t.match(/(?:^|[^A-Z+])(M-|NM|VG\+\+?|VG|G\+|G|M|F|P)(?:[^A-Z+]|$)/);
  if (tok) return GRADE_SYNONYMS[tok[1] === 'VG++' ? 'VG+' : tok[1]] ?? null;
  return null;
}

// ── Format ────────────────────────────────────────────────────────────
function normaliseFormat(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, ' ');
  // multiplier, e.g. "2 x Vinyl, 12\"" / "2xLP" / "3 x 12\""
  const mult = s.match(/(\d+)\s*[x×]\s*(?:vinyl|lp)?\s*,?\s*(12"|10"|7"|lp)?/i);
  const sizeM = s.match(/(12"|10"|7")/);
  const isLP = /\blp\b/i.test(s);
  const isEP = /\bep\b/i.test(s);
  if (mult && (mult[2] || sizeM || isLP)) {
    const n = mult[1];
    const unit = (mult[2] || (sizeM ? sizeM[1] : '') || (isLP ? 'LP' : '')).toUpperCase().replace('LP', 'LP');
    if (unit) return `${n}x${unit === 'LP' ? 'LP' : unit}`;
  }
  if (sizeM) return sizeM[1];
  if (isLP) return 'LP';
  if (isEP) return 'EP';
  return undefined;
}

const PRESSING_PATTERNS: Array<[RegExp, string]> = [
  [/\breissue\b/i, 'Reissue'], [/\brepress\b/i, 'Repress'], [/\boriginal\b/i, 'Original'],
  [/\b1st\s+press|first\s+press\b/i, 'First Press'], [/\bpromo\b/i, 'Promo'],
  [/\btest\s*press/i, 'Test Pressing'], [/\bgatefold\b/i, 'Gatefold'],
  [/\b180\s*g(?:ram)?\b/i, '180g'], [/\bcolou?red\b|\bcolou?r\s+vinyl\b/i, 'Coloured'],
  [/\bpicture\s+disc\b/i, 'Picture Disc'], [/\blimited\b/i, 'Limited'],
  [/\bnumbered\b/i, 'Numbered'], [/\bremaster/i, 'Remastered'],
  [/\bmono\b/i, 'Mono'], [/\bstereo\b/i, 'Stereo'], [/\bwhite\s+label\b/i, 'White Label'],
];
function extractPressingNotes(text: string): string[] {
  const out: string[] = [];
  for (const [re, label] of PRESSING_PATTERNS) if (re.test(text) && !out.includes(label)) out.push(label);
  return out;
}

// ── Labelled-field extraction (multi-language) ───────────────────────
// "Strong" section labels that reliably mark the start of a new field, used to
// bound a field value. Deliberately EXCLUDES the condition-value words
// (vinyl/media/disc/cover/sleeve/jacket): those are matched as condition labels
// but also recur inside values (e.g. Format "2 x Vinyl, 12\"") so they must not
// truncate a value. Includes English + German (Land, Veröffentlicht, Stil).
const DELIMITER_LABELS = [
  'media condition', 'sleeve condition', 'condition',
  'catalogue number', 'catalog number', 'cat no.', 'cat no', 'cat#', 'catalogue', 'catalog',
  'label', 'country', 'land', 'pays',
  'released', 'veröffentlicht', 'veroffentlicht', 'release date', 'year',
  'genre', 'genres', 'style', 'styles', 'stil',
  'format', 'formats', 'barcode', 'ean', 'upc', 'notes', 'comments',
].sort((a, b) => b.length - a.length);

/** Value of a labelled field: text after "label[: ]" up to the next strong label, "|", or end. */
function fieldValue(text: string, labels: string[]): string {
  const lower = text.toLowerCase();
  for (const label of labels) {
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(label, from);
      if (idx < 0) break;
      // word boundary before the label so "vinyl" doesn't fire inside "vinyls"
      const okBefore = idx === 0 || /[^a-z]/i.test(text[idx - 1]);
      let start = idx + label.length;
      // must be followed by a separator to be a label, not a substring
      if (!okBefore || !/[:\s|.\-]/.test(text[start] ?? '')) { from = idx + label.length; continue; }
      while (start < text.length && /[:\s\-.]/.test(text[start])) start++;
      let end = text.length;
      const pipe = text.indexOf('|', start); if (pipe >= 0 && pipe < end) end = pipe;
      for (const other of DELIMITER_LABELS) {
        if (other === label) continue;
        // first word-boundary-respecting occurrence of this delimiter after start
        let j = lower.indexOf(other, start);
        while (j > start && !/[^a-z]/i.test(text[j - 1] ?? ' ')) j = lower.indexOf(other, j + 1);
        if (j > start && j < end) end = j;
      }
      const val = text.slice(start, end).trim().replace(/[,;|]+$/, '').trim();
      if (val) return val;
      from = end;
    }
  }
  return '';
}

// ── Conditions ───────────────────────────────────────────────────────
function extractConditions(text: string, title: string): { media_grade?: VinylGrade; sleeve_grade?: VinylGrade; condition_notes?: string } {
  const notes: string[] = [];
  let media: VinylGrade | undefined;
  let sleeve: VinylGrade | undefined;

  const mc = fieldValue(text, ['media condition', 'vinyl', 'media', 'disc']);
  if (mc) { const g = coerceGrade(mc); if (g) media = g; notes.push(`Media: ${mc}`); }
  const sc = fieldValue(text, ['sleeve condition', 'cover', 'sleeve', 'jacket']);
  if (sc) { const g = coerceGrade(sc); if (g) sleeve = g; notes.push(`Sleeve: ${sc}`); }
  if (!media) {
    const cc = fieldValue(text, ['condition', 'grading', 'grade']);
    if (cc) { const g = coerceGrade(cc); if (g) media = g; notes.push(`Condition: ${cc}`); }
  }
  // Hypesticker / insert grades, captured as notes only.
  const hype = fieldValue(text, ['hypesticker', 'hype sticker', 'insert', 'obi']);
  if (hype) notes.push(`Insert: ${hype}`);

  // Title fallbacks (recycle): "VG+/VG" pair, or a single trailing grade.
  if (!media) {
    const gp = title.match(GRADE_PAIR_RE);
    if (gp) {
      const gm = normaliseGrade(gp[1]); const gs = normaliseGrade(gp[2]);
      if (gm) media = gm;
      if (gs && !sleeve) sleeve = gs;
    } else {
      const tr = title.match(new RegExp(`(?:^|[\\s)])(${GRADE_TOKEN})\\s*$`));
      const g = tr ? normaliseGrade(tr[1]) : null;
      if (g) media = g;
    }
  }
  return { media_grade: media, sleeve_grade: sleeve, condition_notes: notes.length ? notes.join(' | ').slice(0, 600) : undefined };
}

// ── Title ────────────────────────────────────────────────────────────
function parseTitle(title: string): { artist?: string; title?: string } {
  const t = title.trim();
  // "Artist - Title ..." (recycle, Hitman)
  const dash = t.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (dash) {
    let recTitle = dash[2].trim();
    // strip a trailing "| Reissue US 2018"-style suffix and "(SF X) VG+" shelf code + grade
    recTitle = recTitle.split('|')[0].trim();
    recTitle = recTitle.replace(new RegExp(`(?:\\s*\\([^)]*\\))?\\s*(?:${GRADE_TOKEN})\\s*$`), '').trim();
    return { artist: dash[1].trim(), title: recTitle || dash[2].trim() };
  }
  // "ARTIST 'Quoted Title' descriptors" (Goldmine)
  const quoted = t.match(/^(.+?)\s+['‘“]([^'’”]+)['’”]/);
  if (quoted) return { artist: quoted[1].trim(), title: quoted[2].trim() };
  return {};
}

// ── Core extraction from raw listing text ───────────────────────────
export interface VinylTextInput {
  title?:  string | null;
  body?:   string | null;   // HTML or plain; stripped here
  tags?:   string[] | null;
  vendor?: string | null;
  sku?:    string | null;
}

export function parseVinylFromText(input: VinylTextInput): VinylBlock {
  const v: VinylBlock = {};
  const title  = (input.title ?? '').trim();
  const body   = stripHtmlText(input.body);
  const tags   = (Array.isArray(input.tags) ? input.tags : []).map((s) => String(s).trim()).filter(Boolean);
  const vendor = (input.vendor ?? '').trim();
  const sku    = (input.sku ?? '').trim();
  const hay    = [title, ...tags].join(' ');

  // artist / record title
  const t = parseTitle(title);
  if (t.artist) v.artist = t.artist;
  if (t.title)  v.title  = t.title;

  // format: body Format field, else title/tags tokens
  v.format = normaliseFormat(fieldValue(body, ['format', 'formats'])) ?? normaliseFormat(hay);

  // conditions (media + sleeve + raw notes)
  const cond = extractConditions(body || hay, title);
  if (cond.media_grade)    v.media_grade    = cond.media_grade;
  if (cond.sleeve_grade)   v.sleeve_grade   = cond.sleeve_grade;
  if (cond.condition_notes) v.condition_notes = cond.condition_notes;

  // provenance from labelled body fields
  const label   = fieldValue(body, ['label']);
  const catno   = fieldValue(body, ['catalogue number', 'catalog number', 'cat no.', 'cat no', 'cat#', 'catalogue', 'catalog']);
  const country = fieldValue(body, ['country', 'land', 'pays']);
  const yearRaw = fieldValue(body, ['released', 'veröffentlicht', 'veroffentlicht', 'release date', 'year']) || title;
  const barcode = fieldValue(body, ['barcode', 'ean', 'upc']);
  if (catno)   v.catalogue_number = catno.split(',')[0].trim();
  if (country) v.pressing_country = country.split(/[,/]/)[0].trim();
  if (barcode) v.barcode = barcode.split(/\s{2,}/)[0].trim();
  const ym = yearRaw.match(/\b(19|20)\d{2}\b/); if (ym) v.pressing_year = parseInt(ym[0], 10);

  // genres: body Genre/Style fields + tags + vendor "genre : label" split
  const genreSet = new Set<string>();
  for (const g of [fieldValue(body, ['genre', 'genres']), fieldValue(body, ['style', 'styles', 'stil'])]) {
    for (const part of g.split(/[,/]/)) { const p = part.trim(); if (p) genreSet.add(p); }
  }
  // tags that look like genres (skip format/condition tokens)
  for (const tag of tags) {
    if (/^\d*\s*[x×]?\s*(lp|ep|12"|10"|7"|vinyl|cd|cassette)$/i.test(tag)) continue;
    if (coerceGrade(tag)) continue;
    genreSet.add(tag);
  }
  // label + genres from vendor "genre, genre : Label,Label"
  if (vendor) {
    const ci = vendor.indexOf(' : ');
    if (ci >= 0) {
      for (const g of vendor.slice(0, ci).split(',')) { const p = g.trim(); if (p) genreSet.add(p); }
      const labels = [...new Set(vendor.slice(ci + 3).split(',').map((s) => s.trim()).filter(Boolean))];
      if (!v.label && labels.length) v.label = labels.join(', ');
    } else if (!v.label && !label) {
      v.label = vendor;
    }
  }
  if (label) v.label = label;
  if (genreSet.size) v.genres = [...genreSet];

  // catalogue number fallback: variant SKU (dealer stock id) only if body gave none
  if (!v.catalogue_number && sku) v.catalogue_number = sku;

  // matrix / runout
  const mi = body.indexOf('Matrix / Runout');
  if (mi >= 0) {
    let mend = body.length;
    for (const l of ['Rights Society', 'Phonographic Copyright', 'Copyright (c)', 'Pressed By', 'Lacquer Cut', 'Manufactured By', 'Marketed By', 'Distributed By', 'Data provided by Discogs']) {
      const j = body.indexOf(l, mi); if (j >= 0 && j < mend) mend = j;
    }
    const m = body.slice(mi, mend).replace(/\s+/g, ' ').trim();
    if (m) v.matrix_runout = m.slice(0, 500);
  }

  // pressing notes
  const notes = extractPressingNotes([fieldValue(body, ['format', 'formats']), title, body].join(' '));
  if (notes.length) v.pressing_notes = notes;

  return v;
}

export function parseShopifyVinyl(p: ShopifyProduct): VinylBlock {
  return parseVinylFromText({
    title:  p.title,
    body:   p.body_html,
    tags:   Array.isArray(p.tags) ? p.tags : [],
    vendor: p.vendor,
    sku:    p.variants?.[0]?.sku ?? null,
  });
}

/** Body-only parse (kept for callers/tests that pass a Discogs-style body). */
export function parseListingBody(bodyHtml: string | null | undefined): VinylBlock {
  return parseVinylFromText({ body: bodyHtml });
}

// ── CSV row parse ────────────────────────────────────────────────────
export function vinylFromCsvRow(values: Record<string, string>): VinylBlock | null {
  const get = (...keys: string[]): string => {
    for (const k of keys) { const val = (values[k] ?? '').trim(); if (val) return val; }
    return '';
  };
  const block: VinylBlock = {};
  const artist = get('artist');                       if (artist) block.artist = artist;
  const vtitle = get('vinyl_title', 'record_title');  if (vtitle) block.title = vtitle;
  const format = get('format');                       if (format) block.format = normaliseFormat(format) ?? format;
  const label  = get('label');                        if (label)  block.label = label;
  const cat    = get('catalogue_number', 'catalog_number', 'cat_no', 'catno', 'barcode');
  if (cat) block.catalogue_number = cat;
  const country = get('pressing_country', 'country'); if (country) block.pressing_country = country;
  const genres = get('genre', 'genres', 'style', 'styles');
  if (genres) { const g = genres.split(/[,/]/).map((s) => s.trim()).filter(Boolean); if (g.length) block.genres = g; }
  const yearRaw = get('pressing_year', 'year');
  if (yearRaw) { const y = parseInt(yearRaw.replace(/[^0-9]/g, ''), 10); if (Number.isInteger(y) && y > 0) block.pressing_year = y; }
  const media  = normaliseGrade(get('media_grade', 'media'));   if (media)  block.media_grade = media;
  const sleeve = normaliseGrade(get('sleeve_grade', 'sleeve')); if (sleeve) block.sleeve_grade = sleeve;
  const notes  = get('condition_notes', 'notes');  if (notes)  block.condition_notes = notes.slice(0, 2000);
  const matrix = get('matrix_runout', 'matrix');   if (matrix) block.matrix_runout = matrix;
  const pt = get('play_tested').toLowerCase();
  if (pt) block.play_tested = ['true', 'yes', 'y', '1'].includes(pt);
  const did = get('discogs_release_id', 'discogs_id');
  if (did) { const n = parseInt(did.replace(/[^0-9]/g, ''), 10); if (Number.isInteger(n) && n > 0) block.discogs_release_id = n; }
  return Object.keys(block).length > 0 ? block : null;
}

// ── Seller-supplied input (dashboard edit) ───────────────────────────
export function sanitiseVinylInput(
  input: unknown,
): { ok: true; vinyl: VinylBlock } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'vinyl must be an object' };
  const inp = input as Record<string, unknown>;
  const out: VinylBlock = {};

  const strFields: Array<keyof VinylBlock> = [
    'artist', 'title', 'format', 'label', 'catalogue_number',
    'pressing_country', 'condition_notes', 'matrix_runout', 'barcode',
  ];
  for (const k of strFields) {
    const raw = inp[k];
    if (typeof raw === 'string' && raw.trim()) {
      const val = raw.trim();
      (out as Record<string, unknown>)[k] = k === 'condition_notes' ? val.slice(0, 2000) : val;
    }
  }
  if (Array.isArray(inp.genres)) {
    const g = inp.genres.map((x) => String(x).trim()).filter(Boolean);
    if (g.length) out.genres = g;
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
