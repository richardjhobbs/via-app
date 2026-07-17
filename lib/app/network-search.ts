/**
 * lib/app/network-search.ts
 *
 * Single entry point for searching the WHOLE VIA network in one call: VIA-app's
 * own catalogue plus every federated member (RRG today, future verticals later).
 * The MCP discovery tool (app/mcp/route.ts find_seller) and the buyer sourcing
 * loop (lib/app/buyer-matching.ts) both go through here, so "search" means the
 * same thing — the entire network — wherever an agent or a brief asks.
 *
 * Federation model (see the via-network-routing memory): each member exposes the
 * same GET /api/via/search?q=&limit= contract and keeps its own catalogue + buy
 * at origin. We only fan out, blend, and route. Adding a vertical later is one
 * row in NETWORK_MEMBERS + that platform exposing the endpoint — no member is
 * special-cased here, and via-app's own catalogue is just the local source in
 * the same blended pool.
 */
import { searchCatalog, type PublicProduct } from './seller-catalog';
import { relevanceScore } from './via-search';

// VIA network members federated over HTTP. Each exposes GET /api/via/search?q=&limit=
// returning { platform, results:[{name,kind,detail,mcp_url,web_url,image}] }. The
// catalogue and the buy stay at origin; this layer only routes. Append future
// platforms here — nothing else needs to change.
export const NETWORK_MEMBERS: { platform: string; searchUrl: string; wireFeedUrl?: string }[] = [
  { platform: 'rrg', searchUrl: 'https://realrealgenuine.com/api/via/search', wireFeedUrl: 'https://realrealgenuine.com/api/via/wire-feed' },
];

export interface NetworkResult {
  platform:    string;
  name:        string;
  kind:        string;
  detail:      string | null;
  mcp_url:     string;
  web_url:     string | null;
  image:       string | null;
  description: string | null;   // enriched product text, for agentic matching
  tags:        string[];        // style/material/category attributes to reason over
}

// One shape for every product match, whether it is a VIA-app listing or a
// federated member's (RRG). Agentic commerce: every consumer sees ALL products
// in one list, regardless of source. Every searchable product has a working
// product page, so `page_url` is set; `image_url` may be null. Transact over
// `mcp_ref`.
export interface UnifiedProduct {
  source:        string;                 // 'via' | 'rrg' | future member
  title:         string;
  seller:        string | null;          // seller / brand display name
  seller_slug:   string | null;          // slug for routing (parsed for members)
  price_usdc:    number | null;
  price_is_from: boolean;                // true when price is a configurable "from" base
  detail:        string | null;          // stock / sizes / pricing note for the human
  description:   string | null;          // enriched product text, for agentic matching
  tags:          string[];               // style/material/category attributes to reason over
  attributes:    Record<string, unknown>; // structured canonical attributes (may be empty)
  category:      string | null;          // vertical "domain/type" when known (for cross-vertical gating)
  image_url:     string | null;
  page_url:      string | null;          // direct product page
  mcp_ref:       { seller_mcp_url: string; product_id?: string; token_id?: number | null; pricing_mode?: string };
}

// Seller / brand profile hits that had no product match, across all sources.
export interface NetworkSeller {
  source:   string;
  name:     string;
  kind:     string;
  detail:   string | null;
  mcp_url:  string;
  page_url: string | null;
}

async function fetchMember(member: { platform: string; searchUrl: string }, q: string, max: number): Promise<NetworkResult[]> {
  try {
    const url = `${member.searchUrl}?q=${encodeURIComponent(q)}&limit=${max}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const json = await res.json() as { platform?: string; results?: unknown };
    const rows = Array.isArray(json.results) ? json.results : [];
    return rows.map((r: any) => ({
      platform:    json.platform ?? member.platform,
      name:        String(r?.name ?? ''),
      kind:        String(r?.kind ?? 'brand'),
      detail:      r?.detail ?? null,
      mcp_url:     String(r?.mcp_url ?? ''),
      web_url:     r?.web_url ?? null,
      image:       r?.image ?? null,
      description: typeof r?.description === 'string' ? r.description : null,
      tags:        Array.isArray(r?.tags) ? r.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
    })).filter((r) => r.name && r.mcp_url);
  } catch {
    return [];
  }
}

/** Fan out the query to every network member in parallel. One slow/down member
 *  never blocks the others (per-member try/catch + 6s timeout). */
export async function fetchNetwork(q: string, max: number): Promise<NetworkResult[]> {
  const batches = await Promise.all(NETWORK_MEMBERS.map((m) => fetchMember(m, q, max)));
  return batches.flat();
}

/** Parse a seller/brand slug out of a per-seller MCP URL, e.g.
 *  https://realrealgenuine.com/brand/standard-strange/mcp -> standard-strange,
 *  https://app.getvia.xyz/sellers/recycle-vinyl/mcp        -> recycle-vinyl. */
function slugFromMcpUrl(url: string): string | null {
  const m = url.match(/\/(?:brand|brands|sellers?)\/([^/]+)\/mcp/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function viaToUnified(p: PublicProduct): UnifiedProduct {
  const detail = p.pricing_mode === 'configurable'
    ? 'configurable pricing: request a quote'
    : (typeof p.stock === 'number' ? `${p.stock} in stock` : null);
  return {
    source:        'via',
    title:         p.title,
    seller:        p.seller_name,
    seller_slug:   p.seller_slug,
    price_usdc:    p.price_usdc,
    price_is_from: p.price_is_from,
    detail,
    description:   p.description,
    tags:          p.tags.length ? p.tags : (p.kind ? [p.kind] : []),
    attributes:    p.attributes,
    category:      p.category,
    image_url:     p.image_url,
    page_url:      p.product_url,
    mcp_ref:       p.mcp_ref,
  };
}

// A member's /api/via/search returns name + a "Brand · 245.70 USDC · in stock: …"
// detail blob. Pull the brand name and price out of it for the merged shape; keep
// the full blob as `detail` for the sizes the human wants.
function networkToUnified(r: NetworkResult): UnifiedProduct {
  const brand = r.detail ? (r.detail.split('·')[0]?.trim() || null) : null;
  const priceMatch = r.detail ? r.detail.match(/([0-9]+(?:\.[0-9]+)?)\s*USDC/i) : null;
  // Members key a product by their own listing/token id, carried in the product
  // web_url (e.g. .../rrg/drop/1234 or .../drop/1234). Lift it into mcp_ref so the
  // network gateway can route a buy back to the member without a second lookup.
  const tokenMatch = r.web_url ? r.web_url.match(/\/(?:[a-z]+\/)?drop\/(\d+)/i) : null;
  const tokenId = tokenMatch ? Number(tokenMatch[1]) : null;
  return {
    source:        r.platform,
    title:         r.name,
    seller:        brand,
    seller_slug:   slugFromMcpUrl(r.mcp_url),
    price_usdc:    priceMatch ? Number(priceMatch[1]) : null,
    price_is_from: false,
    detail:        r.detail,
    description:   r.description,
    tags:          r.tags,
    attributes:    {},   // members convey facets via `tags` over the federation contract
    category:      null, // members do not send a clean category yet; not gated
    image_url:     r.image,
    page_url:      r.web_url,
    mcp_ref:       { seller_mcp_url: r.mcp_url, token_id: tokenId },
  };
}

/**
 * Search the whole VIA network for a query. Returns ONE blended, relevance-ranked
 * product list across every source (local VIA + members) plus the seller/brand
 * profile hits that had no product match. This is the body that used to live
 * inline in find_seller; both find_seller and buyer-matching now call it so a
 * "search" always spans the network.
 *
 * Ranking here is the generic lexical relevance ordering. Callers that have a
 * richer notion of intent (the buyer sourcing loop) re-rank the returned
 * `products` themselves; the blend + federation is the shared part.
 */
export async function searchNetwork(q: string, max: number): Promise<{ products: UnifiedProduct[]; sellers: NetworkSeller[] }> {
  const safe = q.replace(/[%,()]/g, ' ').trim();
  const [local, network] = await Promise.all([
    searchCatalog(safe, max),
    fetchNetwork(safe, max),
  ]);

  const networkProducts = network.filter((r) => r.kind === 'product');
  const networkSellers  = network.filter((r) => r.kind !== 'product');

  const pool: UnifiedProduct[] = [
    ...local.products.map(viaToUnified),
    ...networkProducts.map(networkToUnified),
  ];
  const products = pool
    .map((item) => ({ item, score: relevanceScore(`${item.title} ${item.seller ?? ''} ${item.detail ?? ''}`, safe) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
    .slice(0, max);

  const sellers: NetworkSeller[] = [
    ...local.sellers.map((s) => ({
      source: 'via', name: s.name, kind: s.kind,
      detail: s.headline ?? s.description, mcp_url: s.mcp_url, page_url: s.page_url,
    })),
    ...networkSellers.map((r) => ({
      source: r.platform, name: r.name, kind: r.kind,
      detail: r.detail, mcp_url: r.mcp_url, page_url: r.web_url,
    })),
  ];

  return { products, sellers };
}

/**
 * RECALL for the buyer matcher / LLM judge: a broad candidate pool that PRESERVES
 * each source's own ranking , local = full-document FTS (title + description +
 * metadata/attributes, so a record matched on its `label` survives), members =
 * their own relevance. Deliberately does NOT re-rank by title-lexical relevance
 * (the way `searchNetwork` does for the interactive find_seller list): that
 * title-only re-rank drops items matched on description/attributes before the
 * judge can reason over them. The judge does the real selection downstream.
 */
export async function recallNetwork(q: string, localMax: number, memberMax: number): Promise<{ local: UnifiedProduct[]; members: UnifiedProduct[] }> {
  const safe = q.replace(/[%,()]/g, ' ').trim();
  const [local, network] = await Promise.all([
    searchCatalog(safe, localMax),
    fetchNetwork(safe, memberMax),
  ]);
  const members = network.filter((r) => r.kind === 'product').map(networkToUnified);
  // Each source keeps its own full-document ranking; the caller interleaves them
  // so neither source's volume starves the other before the judge.
  return { local: local.products.map(viaToUnified), members };
}

