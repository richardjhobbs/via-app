/**
 * lib/app/via-product.ts
 *
 * The CANONICAL, vertical-agnostic product shape for the VIA network. Every
 * member exposes a product in this shape over the HTTP federation contract
 * (/api/via/search) and its per-seller MCP, so the network can read a rich,
 * uniform product for ANY vertical (vinyl, apparel, food, parts, ...) regardless
 * of which member listed it.
 *
 * This interface is duplicated BY VALUE in each member repo (never imported
 * across repos): the members are separate deployments on separate Supabase
 * projects and federate over HTTP only, never a shared package or SQL union.
 *
 * Runtime carriers: via-app's `PublicProduct` (lib/app/seller-catalog.ts) and the
 * blended `UnifiedProduct` (lib/app/network-search.ts) conform to this shape; RRG
 * maps its `AgentProduct` (lib/rrg/mcp-product-shape.ts) onto it.
 */

/** What a product IS, distilled to data a matcher can reason over. Sourced per
 *  category from the best authoritative source (vinyl: listing + Discogs;
 *  apparel: listing + image vision). See metadata.via_enrichment / RRG
 *  product_attributes. */
export interface ViaEnrichment {
  agentDescription: string | null;            // agent-readable prose; falls back to raw description
  attributes:       Record<string, unknown>;  // structured, category-specific facets
  tags:             string[];                  // short flattened facets for recall/ranking
  category:         string | null;            // "music/vinyl", "apparel/denim", ...
  conditionGrade:   string | null;            // resale/consignment only
}

/** Fulfilment INFO, surfaced not computed. No landed cost, no shipping total at
 *  this stage (only a few members have synced shipping). `shippingBasis`
 *  describes how the seller handles shipping; cost is confirmed with the seller. */
export interface ViaFulfilment {
  shipsFrom:      string | null;
  shipsTo:        string | null;                       // policy summary, e.g. "worldwide", "UK only"
  shippingBasis:  'flat' | 'live' | 'quote' | 'unknown';
  deliveryWindow: string | null;
  returns:        string | null;
  terms:          string | null;
}

export interface ViaProductVariant {
  label:     string | null;
  size:      string | null;
  color:     string | null;
  sku:       string | null;
  inStock:   boolean;
  stock:     number | null;
  priceUsdc: number | null;
}

export interface ViaProduct {
  // identity
  source:       string;            // 'via' | 'rrg' | future member
  seller_slug:  string | null;
  seller_name:  string | null;
  product_id:   string;            // stable ref (uuid for via, member URL/token for others)
  page_url:     string | null;     // direct human product page
  mcp_url:      string;            // per-seller MCP to transact
  image_url:    string | null;
  // commerce (price as listed; shipping is extra, confirmed with seller)
  price_usdc:    number | null;
  price_is_from: boolean;
  currency:      string;
  pricing_mode:  string;
  // availability
  in_stock:  boolean | null;
  stock:     number | null;
  variants:  ViaProductVariant[];
  // enrichment + fulfilment
  enrichment:  ViaEnrichment;
  fulfilment:  ViaFulfilment;
}

const EMPTY_ENRICHMENT: ViaEnrichment = {
  agentDescription: null, attributes: {}, tags: [], category: null, conditionGrade: null,
};

/**
 * Build the canonical enrichment view from a via-app product's `metadata` jsonb.
 * Prefers the generic `metadata.via_enrichment` block (written by the Phase 3
 * enricher) and falls back to the vinyl block so vinyl is data-rich TODAY without
 * waiting for the backfill. Never throws on malformed metadata.
 */
export function enrichmentFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  rawDescription: string | null,
  kind: string | null,
): ViaEnrichment {
  if (!metadata || typeof metadata !== 'object') {
    return { ...EMPTY_ENRICHMENT, agentDescription: rawDescription, tags: kind ? [kind] : [] };
  }
  const ve = metadata.via_enrichment;
  if (ve && typeof ve === 'object') {
    const v = ve as Record<string, unknown>;
    return {
      agentDescription: typeof v.agentDescription === 'string' ? v.agentDescription : rawDescription,
      attributes:       (v.attributes && typeof v.attributes === 'object') ? v.attributes as Record<string, unknown> : {},
      tags:             Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
      category:         typeof v.category === 'string' ? v.category : null,
      conditionGrade:   typeof v.conditionGrade === 'string' ? v.conditionGrade : null,
    };
  }
  // Vinyl fallback: the metadata.vinyl block IS the enrichment for records.
  const vinyl = metadata.vinyl;
  if (vinyl && typeof vinyl === 'object') {
    const b = vinyl as Record<string, unknown>;
    const tagVals: string[] = [];
    for (const key of ['format', 'label', 'media_grade', 'sleeve_grade', 'pressing_country']) {
      const x = b[key];
      if (typeof x === 'string' && x.trim()) tagVals.push(x.trim());
    }
    for (const key of ['genres', 'pressing_notes']) {
      const x = b[key];
      if (Array.isArray(x)) for (const t of x) if (typeof t === 'string' && t.trim()) tagVals.push(t.trim());
    }
    return {
      agentDescription: rawDescription,
      attributes:       b,
      tags:             tagVals.slice(0, 24),
      category:         'music/vinyl',
      conditionGrade:   typeof b.media_grade === 'string' ? b.media_grade : null,
    };
  }
  return { ...EMPTY_ENRICHMENT, agentDescription: rawDescription, tags: kind ? [kind] : [] };
}
