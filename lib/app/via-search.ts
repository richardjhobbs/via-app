/**
 * Shared free-text matching for VIA network discovery search.
 *
 * The discovery surfaces (app/mcp/route.ts find_seller, app/api/via/search)
 * run PostgREST `ilike` over directory + catalogue text. A raw whole-phrase
 * `%query%` is brittle: "books" never matches the catalogue word "book", and a
 * multi-word phrase only matches a verbatim substring. This builds a broader
 * OR filter from the query so discovery recalls sellers even on loose wording,
 * then returns seller pointers (the catalogue and the buy stay at origin).
 *
 * Strategy: strip PostgREST-significant punctuation, split into tokens, drop
 * tokens shorter than 3 chars, and for each token also match a de-pluralised
 * variant (trailing "s" removed). The full sanitised phrase is included too, so
 * a verbatim match still ranks. All variants are OR'd across the given columns.
 */

function sanitise(query: string): string {
  return query.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Distinct lowercase search variants derived from a free-text query. */
export function searchVariants(query: string): string[] {
  const safe = sanitise(query);
  if (!safe) return [];
  const variants = new Set<string>();
  variants.add(safe.toLowerCase());
  for (const token of safe.toLowerCase().split(' ')) {
    if (token.length < 3) continue;
    variants.add(token);
    if (token.endsWith('s') && token.length > 3) variants.add(token.slice(0, -1));
  }
  return Array.from(variants);
}

/**
 * Precision filter applied AFTER the broad `buildIlikeOr` recall query: a row
 * matches only when EVERY significant query token (or its de-pluralised form)
 * appears in the given text. Stops "unicorn slippers" from matching a book that
 * merely contains the word "unicorn". Single-token queries behave like a plain
 * substring match; a query with no significant tokens matches on the raw phrase.
 */
export function matchesAllTokens(text: string, query: string): boolean {
  const safe = query.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = (text || '').toLowerCase();
  const groups: string[][] = [];
  for (const token of safe.split(' ')) {
    if (token.length < 3) continue;
    const forms = [token];
    if (token.endsWith('s') && token.length > 3) forms.push(token.slice(0, -1));
    groups.push(forms);
  }
  if (groups.length === 0) return safe ? hay.includes(safe) : true;
  return groups.every((forms) => forms.some((f) => hay.includes(f)));
}

/**
 * Build a PostgREST `.or()` filter string matching any variant against any
 * column, e.g. `name.ilike.%book%,description.ilike.%book%`. Returns null when
 * the query yields no usable tokens (caller should then list without a filter).
 */
export function buildIlikeOr(columns: string[], query: string): string | null {
  const variants = searchVariants(query);
  if (variants.length === 0) return null;
  const clauses: string[] = [];
  for (const col of columns) {
    for (const v of variants) clauses.push(`${col}.ilike.%${v}%`);
  }
  return clauses.length > 0 ? clauses.join(',') : null;
}
