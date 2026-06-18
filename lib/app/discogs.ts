/**
 * lib/app/discogs.ts
 *
 * Discogs resolver for vinyl enrichment (Phase 3). Vinyl is enriched from DATA,
 * not images: the listing parse (lib/app/vinyl.ts) gives the artist/title; this
 * resolver looks the release up on Discogs and returns the AUTHORITATIVE pressing
 * facts , label, catalogue number, year, country, genres , so a thin or garbled
 * listing becomes clean, matchable data. Picks the ORIGINAL pressing (not a
 * reissue, earliest year) so "first pressing" / date-window briefs are accurate.
 *
 * Auth: works unauthenticated with a User-Agent (rate-limited ~25/min). Set
 * DISCOGS_TOKEN for a higher limit (~60/min). Never throws , returns null on any
 * miss/error so the caller can skip and move on.
 */

const DISCOGS = 'https://api.discogs.com';
const UA = 'VIA-Labs-Enrichment/1.0 (+https://getvia.xyz)';

export interface DiscogsResolved {
  discogs_release_id: number;
  label?: string;
  catalogue_number?: string;
  pressing_year?: number;
  pressing_country?: string;
  genres?: string[];
  format?: string;
  pressing_notes?: string[];
}

interface SearchResult {
  id: number;
  year?: string | number;
  country?: string;
  label?: string[];
  catno?: string;
  format?: string[];
}

function authedUrl(path: string, params: Record<string, string>): string {
  const u = new URL(DISCOGS + path);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const token = process.env.DISCOGS_TOKEN;
  if (token) u.searchParams.set('token', token);
  return u.toString();
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const isReissue = (formats: string[] | undefined): boolean =>
  (formats ?? []).some((f) => /reissue|\bre\b|repress/i.test(f));

const yearNum = (y: string | number | undefined): number => {
  const n = typeof y === 'number' ? y : parseInt(String(y ?? ''), 10);
  return Number.isInteger(n) && n > 1900 && n < 2100 ? n : 0;
};

/** Pick the ORIGINAL pressing: prefer non-reissue with the earliest real year;
 *  fall back to the earliest-year result; else the first result. */
function pickOriginal(results: SearchResult[]): SearchResult | null {
  if (results.length === 0) return null;
  const withYear = results.filter((r) => yearNum(r.year) > 0);
  const originals = withYear.filter((r) => !isReissue(r.format));
  const pool = originals.length ? originals : (withYear.length ? withYear : results);
  return [...pool].sort((a, b) => (yearNum(a.year) || 9999) - (yearNum(b.year) || 9999))[0] ?? results[0];
}

/**
 * Resolve a vinyl release to authoritative pressing facts. Prefers a precise
 * lookup by catalogue number / barcode when available, else artist + title.
 */
export async function resolveVinyl(input: {
  artist?: string | null;
  title?: string | null;
  catalogue_number?: string | null;
  barcode?: string | null;
}): Promise<DiscogsResolved | null> {
  const artist = (input.artist ?? '').trim();
  const title = (input.title ?? '').trim();
  const catno = (input.catalogue_number ?? '').trim();
  const barcode = (input.barcode ?? '').trim();
  if (!catno && !barcode && !(artist && title)) return null;

  const params: Record<string, string> = { type: 'release', format: 'Vinyl', per_page: '15' };
  if (barcode) params.barcode = barcode;
  else if (catno) { params.catno = catno; if (artist) params.artist = artist; }
  else { params.artist = artist; params.release_title = title; }

  const search = await getJson(authedUrl('/database/search', params));
  const results: SearchResult[] = Array.isArray(search?.results) ? search.results : [];
  const chosen = pickOriginal(results);
  if (!chosen) return null;

  const out: DiscogsResolved = {
    discogs_release_id: chosen.id,
    label: (chosen.label ?? [])[0]?.trim() || undefined,
    catalogue_number: chosen.catno?.trim() || undefined,
    pressing_year: yearNum(chosen.year) || undefined,
    pressing_country: chosen.country?.trim() || undefined,
    format: (chosen.format ?? []).join(', ') || undefined,
  };

  // One release lookup enriches genres/styles + format descriptions (Gatefold,
  // 180g, etc.). Best-effort: the search facts already stand if this fails.
  const rel = await getJson(authedUrl(`/releases/${chosen.id}`, {}));
  if (rel) {
    const toStr = (arr: unknown): string[] =>
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    const genres: string[] = [...toStr(rel.genres), ...toStr(rel.styles)];
    if (genres.length) out.genres = Array.from(new Set(genres)).slice(0, 8);
    const fmts: Array<{ descriptions?: unknown }> = Array.isArray(rel.formats) ? rel.formats : [];
    const notes: string[] = [];
    for (const f of fmts) for (const d of toStr(f.descriptions)) notes.push(d);
    if (notes.length) out.pressing_notes = Array.from(new Set(notes)).slice(0, 8);
    if (!out.pressing_year && yearNum(rel.year)) out.pressing_year = yearNum(rel.year);
  }
  return out;
}
