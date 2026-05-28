/**
 * lib/app/mcp-product-shape.ts
 *
 * Single source of truth for how an RRG listing is projected to agents
 * over MCP. Both the platform MCP (`/mcp` — list_drops, get_drop_details)
 * and the per-brand MCP (`/brand/[slug]/mcp` — list_products, get_product)
 * import this so the shapes stay aligned. Without it, the two endpoints
 * drift whenever either side adds a field.
 *
 * Merchant-aware output:
 *   direct_brand           — product attribute + image-analysis fields only
 *   reseller_authenticated — plus authentication anchors (SKU, original
 *                            release, authenticator, provenance, token
 *                            semantics, resale value context)
 *   curated_consignment    — plus condition grade + resale value context
 *                            (for pre-loved single-piece inventory)
 *
 * The mode is resolved from, in order:
 *   1. product_attributes.resale_mode === true on the submission row
 *      (lets a single archive piece inside a direct brand override)
 *   2. brand.brand_data.merchant_type
 *   3. fallback 'direct_brand'
 */

import type { RrgSubmission, RrgBrand, RrgProductVariant } from './db';

export type MerchantType = 'direct_brand' | 'reseller_authenticated' | 'curated_consignment';

export function resolveMerchantMode(
  drop: Pick<RrgSubmission, 'product_attributes'>,
  brand: Pick<RrgBrand, 'brand_data'> | null,
): MerchantType {
  const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;
  if (attrs.resale_mode === true) return 'reseller_authenticated';
  const brandData = (brand?.brand_data ?? {}) as Record<string, unknown>;
  const bm = brandData.merchant_type;
  if (bm === 'reseller_authenticated' || bm === 'curated_consignment' || bm === 'direct_brand') {
    return bm;
  }
  return 'direct_brand';
}

export interface AgentVariant {
  size: string | null;
  color: string | null;
  sku: string | null;
  inStock: boolean;
  stock: number;
  priceOverride: number | null;
  priceUsdc: number;
}

export interface AgentProduct {
  tokenId: number | null;
  title: string;
  description: string | null;
  agentDescription: string | null;
  sellerId: string;
  sellerName: string;
  brandWebsite: string | null;
  merchantType: MerchantType;
  assetType: 'physical_product_with_nft_proof_of_ownership' | 'digital_asset';
  isPhysicalProduct: boolean;
  priceUsdc: string | null;
  basePriceUsdc: number;
  priceRangeUsdc: { min: number; max: number } | null;
  hasPerSizePricing: boolean;
  pricingNote: string | null;
  editionSize: number | null;
  availablePhysicalUnits: number | null;
  remaining: number | null;
  productAttributes: Record<string, unknown> | null;
  styleTags: string[];
  occasionFit: string[];
  buyerIntentSignals: string[];
  conditionGrade: string | null;
  conditionDetail: string | null;
  visualDescription: string | null;
  brandContext: string | null;
  // Reseller / consignment-only fields (null for direct_brand)
  authenticationStatus: string | null;
  retailSku: string | null;
  originalRelease: string | null;
  canonicalName: string | null;
  collab: string | null;
  releaseYear: string | null;
  authenticationProvenance: string | null;
  physicalTokenSemantics: string | null;
  resaleValueContext: string | null;
  ecommerceUrl: string | null;
  rrgUrl: string;
  variants: AgentVariant[];
}

function asString(attrs: Record<string, unknown>, k: string): string | null {
  const v = attrs[k];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asStringArray(attrs: Record<string, unknown>, k: string): string[] {
  const v = attrs[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

interface ProjectParams {
  drop: RrgSubmission;
  brand: RrgBrand | null;
  variants: RrgProductVariant[];
  sold?: number;
  siteUrl?: string;
}

/**
 * Project a submission + brand + variants into the agent-facing shape.
 * Called by both the platform MCP and the per-brand MCP.
 */
export function toAgentProduct({ drop, brand, variants, sold = 0, siteUrl }: ProjectParams): AgentProduct {
  const mode = resolveMerchantMode(drop, brand);
  const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;
  const basePrice = Number(drop.price_usdc ?? 0);

  const variantShapes: AgentVariant[] = variants
    .filter(v => v.size != null || v.color != null || v.shopify_variant_id != null)
    .map(v => {
      const priceOverride = v.price_override != null ? Number(v.price_override) : null;
      return {
        size:          v.size,
        color:         v.color,
        sku:           v.sku,
        inStock:       v.cached_stock > 0,
        stock:         v.cached_stock,
        priceOverride,
        priceUsdc:     priceOverride ?? basePrice,
      };
    });

  const inStockPrices = variantShapes.filter(v => v.inStock).map(v => v.priceUsdc);
  const priceRangeUsdc = inStockPrices.length > 0
    ? { min: Math.min(...inStockPrices), max: Math.max(...inStockPrices) }
    : null;
  const hasPerSizePricing = new Set(inStockPrices).size > 1;
  const hasSizeAxis  = variantShapes.some(v => v.size  != null);
  const hasColorAxis = variantShapes.some(v => v.color != null);

  const totalVariantStock = variantShapes.reduce((s, v) => s + Math.max(0, v.stock), 0);
  const availablePhysicalUnits = drop.is_physical_product
    ? (totalVariantStock > 0 ? totalVariantStock : (drop.edition_size ?? null))
    : null;
  const remaining = variantShapes.length > 0
    ? totalVariantStock
    : ((drop.edition_size ?? 0) - sold);

  const includeResellerAnchors = mode !== 'direct_brand';
  const includeCondition = mode !== 'direct_brand';

  const axisHints: string[] = [];
  if (hasSizeAxis)  axisHints.push('selected_size');
  if (hasColorAxis) axisHints.push('selected_color');
  const axisList = axisHints.join(' + ');
  const axisLabel = (hasSizeAxis && hasColorAxis) ? 'size + colour'
                    : hasSizeAxis  ? 'size'
                    : hasColorAxis ? 'colour'
                    : '';

  const pricingNote = variantShapes.length === 0 ? null :
    (hasPerSizePricing
      ? `This listing has per-variant pricing. priceUsdc is the BASE only (often the floor for sold-out variants). Use variants[].priceUsdc for the ${axisLabel} you actually want, and pass ${axisList} to the purchase tools so the payment amount matches.`
      : `All in-stock variants share the same price. Still pass ${axisList} when purchasing so the order records the correct ${axisLabel}.`);

  const rrgBase = siteUrl ?? 'https://realrealgenuine.com';
  const rrgUrl  = `${rrgBase}/rrg/drop/${drop.token_id}`;

  return {
    tokenId:     drop.token_id ?? null,
    title:       drop.title,
    description: drop.description,
    agentDescription: drop.enhanced_description ?? null,
    sellerId:     drop.brand_id ?? '',
    sellerName:   brand?.name ?? 'RRG',
    brandWebsite: brand?.website_url ?? null,
    merchantType: mode,
    assetType: drop.is_physical_product
      ? 'physical_product_with_nft_proof_of_ownership'
      : 'digital_asset',
    isPhysicalProduct: drop.is_physical_product ?? false,
    priceUsdc:   drop.price_usdc,
    basePriceUsdc: basePrice,
    priceRangeUsdc,
    hasPerSizePricing,
    pricingNote,
    editionSize: drop.edition_size ?? null,
    availablePhysicalUnits,
    remaining,
    productAttributes: Object.keys(attrs).length > 0 ? attrs : null,
    styleTags:    asStringArray(attrs, 'style_tags'),
    occasionFit:  asStringArray(attrs, 'occasion_fit'),
    buyerIntentSignals: asStringArray(attrs, 'buyer_intent_signals'),
    conditionGrade: includeCondition ? asString(attrs, 'condition_grade') : null,
    conditionDetail: includeCondition ? asString(attrs, 'condition_detail') : null,
    visualDescription: asString(attrs, 'visual_description'),
    brandContext:     asString(attrs, 'brand_context'),
    // Reseller-only anchors — suppressed for direct_brand so the payload stays clean
    authenticationStatus:     includeResellerAnchors ? asString(attrs, 'authentication_status') : null,
    retailSku:                includeResellerAnchors ? asString(attrs, 'retail_sku') : null,
    originalRelease:          includeResellerAnchors ? asString(attrs, 'original_release') : null,
    canonicalName:            includeResellerAnchors ? asString(attrs, 'canonical_name') : null,
    collab:                   includeResellerAnchors ? asString(attrs, 'collab') : null,
    releaseYear:              includeResellerAnchors ? asString(attrs, 'release_year') : null,
    authenticationProvenance: includeResellerAnchors ? asString(attrs, 'authentication_provenance') : null,
    physicalTokenSemantics:   includeResellerAnchors ? asString(attrs, 'physical_token_semantics') : null,
    resaleValueContext:       includeResellerAnchors ? asString(attrs, 'resale_value_context') : null,
    ecommerceUrl: drop.ecommerce_url ?? null,
    rrgUrl,
    variants: variantShapes,
  };
}
