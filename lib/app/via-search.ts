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
 * Relevance filter applied AFTER the broad `buildIlikeOr` recall query. A row
 * is relevant when it matches at least `min(tokenCount, 2)` distinct query
 * tokens (or their de-pluralised form). For two-word queries that means both
 * ("unicorn slippers" needs unicorn AND slipper, so it does not match a book
 * that merely says "unicorn"); for three or more, at least two ("raw denim
 * jean" keeps denim+jean even when "raw" is absent from the text). One-token
 * queries match on that single token; a query with no significant tokens
 * matches on the raw phrase.
 */
export function matchesQuery(text: string, query: string): boolean {
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
  const need = Math.min(groups.length, 2);
  let matched = 0;
  for (const forms of groups) if (forms.some((f) => hay.includes(f))) matched++;
  return matched >= need;
}

/**
 * Relevance score for ranking ALREADY-matched rows against each other. Counts
 * how many distinct query tokens (or de-pluralised forms) the text contains,
 * plus a bonus when the whole sanitised phrase appears verbatim. Used to
 * interleave results from heterogeneous sources (VIA-app catalogue + federated
 * network members) into one "best options" ordering. Higher is better; 0 means
 * no token hit. Does not gate inclusion (that is `matchesQuery`'s job), only order.
 */
export function relevanceScore(text: string, query: string): number {
  const safe = query.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = (text || '').toLowerCase();
  if (!safe) return 0;
  let score = 0;
  for (const token of safe.split(' ')) {
    if (token.length < 3) continue;
    const forms = [token];
    if (token.endsWith('s') && token.length > 3) forms.push(token.slice(0, -1));
    if (forms.some((f) => hay.includes(f))) score++;
  }
  if (hay.includes(safe)) score++;
  return score;
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
