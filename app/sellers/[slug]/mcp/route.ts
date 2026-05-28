/**
 * Per-brand MCP endpoint,  /brand/{slug}/mcp
 *
 * Provides brand-scoped tools: list_products, get_product (with live Shopify
 * stock via 60s cache), get_sizing_guide, buy_product.
 *
 * This is the first step of the hybrid discovery/transaction architecture:
 * agents discover brands via the central /mcp, then connect to per-brand
 * endpoints for deeper interaction.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  db,
  getSellerBySlug,
  getApprovedDrops,
  getDropByTokenId,
  getVariantsBySubmissionId,
  getSizingByBrand,
  getSizingByCategory,
  getPurchaseCountsByTokenIds,
  type RrgBrand,
  type RrgProductVariant,
} from '@/lib/app/db';
import { getRRGReadOnly } from '@/lib/app/contract';
import { toAgentProduct } from '@/lib/app/mcp-product-shape';
import {
  logMcpInteraction,
  parseAgentIdentity,
  type McpToolName,
} from '@/lib/app/mcp-interactions';

export const dynamic = 'force-dynamic';

// ── Shopify Storefront API stock lookup (60s in-memory cache) ────────

interface StockEntry {
  variantId: string;
  available: number;
  fetchedAt: number;
}

const stockCache = new Map<string, StockEntry>();
const STOCK_CACHE_TTL_MS = 60_000;

/**
 * Fetch live inventory from Shopify Storefront API via products.json
 * (public endpoint, no token needed). Returns variant_id → quantity map.
 */
async function fetchShopifyStock(shopifyDomain: string): Promise<Map<string, number>> {
  const url = `https://${shopifyDomain}/products.json?limit=250`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RRG-BrandMCP/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const json = await res.json();

  const map = new Map<string, number>();
  for (const product of json.products ?? []) {
    for (const variant of product.variants ?? []) {
      // Use inventory_quantity if present and > 0; otherwise use `available` boolean
      const rawQty = parseInt(variant.inventory_quantity, 10);
      const stock = (!isNaN(rawQty) && rawQty > 0) ? rawQty : (variant.available === true ? 1 : 0);
      map.set(String(variant.id), stock);
    }
  }
  return map;
}

/**
 * Get cached stock for a variant, refreshing from Shopify if stale.
 */
async function getVariantStock(
  shopifyDomain: string | null,
  variant: RrgProductVariant,
): Promise<number> {
  if (!shopifyDomain || !variant.shopify_variant_id) return variant.cached_stock;

  const cached = stockCache.get(variant.shopify_variant_id);
  if (cached && Date.now() - cached.fetchedAt < STOCK_CACHE_TTL_MS) {
    return cached.available;
  }

  // Refresh entire store stock (one call refreshes all variants)
  try {
    const freshStock = await fetchShopifyStock(shopifyDomain);
    const now = Date.now();
    for (const [vid, qty] of freshStock) {
      stockCache.set(vid, { variantId: vid, available: qty, fetchedAt: now });
    }
    return freshStock.get(variant.shopify_variant_id) ?? variant.cached_stock;
  } catch (e) {
    console.error('[brand-mcp] stock fetch failed:', e);
    return variant.cached_stock; // fallback to DB cache
  }
}

// ── Server factory ───────────────────────────────────────────────────

/**
 * Helper injected into each tool handler: fire-and-forget log to
 * mcp_interactions. The via-brand-onboarding credit engine reads these.
 */
type LogTool = (tool: McpToolName, opts?: { completed?: boolean }) => void;

function createBrandServer(brand: RrgBrand, logTool: LogTool = () => {}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';

  const server = new McpServer(
    {
      name: `${brand.name} on RRG`,
      version: '1.0.0',
    },
    {
      instructions: [
        `# ${brand.name},  Brand Concierge`,
        '',
        `Welcome to the ${brand.name} MCP endpoint on Real Real Genuine.`,
        brand.description ? `\n${brand.description}\n` : '',
        'This endpoint provides brand-scoped tools for browsing products,',
        'checking live stock and sizing, and purchasing.',
        '',
        '## Available Tools',
        '- `list_products`,  Browse all products from this brand',
        '- `get_product`,  Get full details including live stock per size/variant',
        brand.supports_sizing ? '- `get_sizing_guide`,  Size charts and fit advice' : '',
        '- `get_quote`,  Live shipping quote for a product + size + destination',
        '- `buy_product`,  Initiate a purchase (returns payment instructions)',
        '- `get_brand_knowledge`,  Policies, FAQs, sizing rules, shipping terms (authoritative)',
        '',
        `Storefront: ${siteUrl}/brand/${brand.slug}`,
        brand.website_url ? `Website: ${brand.website_url}` : '',
      ].filter(Boolean).join('\n'),
    },
  );

  // ── list_products ──────────────────────────────────────────────────

  server.tool(
    'list_products',
    `List all products from ${brand.name}. Returns full agent-facing payload per item,  including agentDescription (full, not truncated), styleTags, occasionFit, conditionGrade, authenticationStatus, priceUsdc/priceEur, and provenance,  so a buyer's agent can filter and reason without per-item fan-out calls. Fields populated only for listings whose vision-enrichment has run; otherwise null/empty.`,
    {},
    async () => {
      logTool('list_products');
      const drops = await getApprovedDrops(brand.id);
      if (drops.length === 0) {
        return { content: [{ type: 'text', text: `No products listed for ${brand.name} yet.` }] };
      }

      const tokenIds = drops.map(d => d.token_id).filter((id): id is number => id != null);
      const purchaseCounts = await getPurchaseCountsByTokenIds(tokenIds);

      const products = await Promise.all(drops.map(async (drop) => {
        const variants = await getVariantsBySubmissionId(drop.id);
        const sold = purchaseCounts.get(drop.token_id!) ?? 0;

        // Overlay live Shopify stock onto DB cached_stock before projection.
        // Fresh stock for Shopify-backed brands; DB value for everything else.
        const liveVariants = await Promise.all(
          variants.map(async (v) => {
            const liveStock = await getVariantStock(brand.shopify_domain, v);
            return { ...v, cached_stock: liveStock };
          })
        );

        // Canonical agent-product shape (shared with platform MCP). Reseller
        // anchors surface only when the brand's merchant_type is resale.
        const shape = toAgentProduct({ drop, brand, variants: liveVariants, sold, siteUrl });
        const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;

        return {
          ...shape,
          // Per-brand MCP extras preserved for existing consumers
          brand:    shape.sellerName,
          category: typeof attrs.category === 'string' ? attrs.category : null,
          priceEur: typeof attrs.price_eur === 'number' ? attrs.price_eur : null,
          inStock:  shape.variants.length > 0
            ? shape.variants.some(v => v.inStock)
            : (shape.remaining ?? 0) > 0,
          availableSizes:   shape.variants.filter(v => v.inStock).map(v => v.size).filter(Boolean),
          totalVariants:    shape.variants.length,
          inStockVariants:  shape.variants.filter(v => v.inStock).length,
          isPhysical:       shape.isPhysicalProduct,
        };
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ brand: brand.name, products }, null, 2) }],
      };
    },
  );

  // ── get_product ────────────────────────────────────────────────────

  server.tool(
    'get_product',
    `Get full product details for one item. Returns flattened agent-facing fields at the top level (agentDescription, styleTags, occasionFit, conditionGrade, authenticationStatus, brandContext, resaleValueContext, buyerIntentSignals) plus the complete productAttributes JSON, plus live stock per size/color variant. Use this when you need every detail about a single item before purchasing.`,
    {
      token_id: z.number().describe('The RRG token ID of the product'),
    },
    async ({ token_id }) => {
      logTool('get_product');
      const drop = await getDropByTokenId(token_id);
      if (!drop || drop.brand_id !== brand.id) {
        return { isError: true, content: [{ type: 'text', text: `Product #${token_id} not found for ${brand.name}` }] };
      }

      const variants = await getVariantsBySubmissionId(drop.id);
      const counts = await getPurchaseCountsByTokenIds([token_id]);
      const sold = counts.get(token_id) ?? 0;

      // Overlay live Shopify stock onto DB cached_stock before projection.
      const liveVariants = await Promise.all(
        variants.map(async (v) => {
          const liveStock = await getVariantStock(brand.shopify_domain, v);
          return { ...v, cached_stock: liveStock };
        })
      );

      const shape = toAgentProduct({ drop, brand, variants: liveVariants, sold, siteUrl });
      const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;

      const result = {
        ...shape,
        // Per-brand MCP extras: flattened category + EUR price + sized helpers
        brand:    shape.sellerName,
        category: typeof attrs.category === 'string' ? attrs.category : null,
        priceEur: typeof attrs.price_eur === 'number' ? attrs.price_eur : null,
        sold,
        isPhysical:     shape.isPhysicalProduct,
        sizingCategory: drop.sizing_category,
        sizesInStock:    shape.variants.filter(v => v.inStock).map(v => v.size).filter(Boolean),
        sizesOutOfStock: shape.variants.filter(v => !v.inStock).map(v => v.size).filter(Boolean),
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── get_sizing_guide ───────────────────────────────────────────────

  if (brand.supports_sizing) {
    server.tool(
      'get_sizing_guide',
      `Get the ${brand.name} sizing guide. Returns measurement charts and fit notes per category (tops, bottoms, outerwear, etc).`,
      {
        category: z.string().optional().describe('Filter by category: tops, bottoms, outerwear, skirts. Omit for all categories.'),
      },
      async ({ category }) => {
        // get_sizing_guide isn't in the credit-eligible tool set, but we
        // still log it under list_products to keep the counter honest.
        logTool('list_products');
        let sizing;
        if (category) {
          const single = await getSizingByCategory(brand.id, category);
          sizing = single ? [single] : [];
        } else {
          sizing = await getSizingByBrand(brand.id);
        }

        if (sizing.length === 0) {
          return { content: [{ type: 'text', text: `No sizing guide found${category ? ` for category "${category}"` : ''}.` }] };
        }

        const result = sizing.map(s => ({
          category: s.category,
          unit: s.unit,
          fitNotes: s.fit_notes,
          sizeChart: s.size_chart,
          sourceUrl: s.source_url,
        }));

        return { content: [{ type: 'text', text: JSON.stringify({ brand: brand.name, sizing: result }, null, 2) }] };
      },
    );
  }

  // ── get_quote ──────────────────────────────────────────────────────
  // Live shipping rates from the brand's Shopify store using the public
  // Storefront API token (stored on app_sellers.shopify_storefront_token_
  // encrypted, prefix "plaintext:" in dev). The flow creates an ephemeral
  // GraphQL cart with the line items + destination, reads deliveryOptions,
  // and discards the cart,  Shopify never creates an order. See
  // lib/app/shopify-shipping.ts. Falls back to brand_data.shipping
  // flat-rate config when no token is provisioned or the API call fails.
  server.tool(
    'get_quote',
    `Get a live shipping quote for a ${brand.name} product from the buyer's country. Rates come from the brand's Shopify store via the Storefront API. Falls back to flat-rate config if no token is configured. Returns rates sorted cheapest-first.`,
    {
      token_id:        z.number().describe('The RRG token ID of the product'),
      size:            z.string().optional().describe('Size,  required if the product has a size axis with multiple values'),
      color:           z.string().optional().describe('Colourway,  required if the product has a colour axis with multiple values (e.g. "Modern Chrome", "Brushed Steel")'),
      quantity:        z.number().int().positive().default(1).describe('Units to quote for (default 1)'),
      shipping_address: z.object({
        address1:    z.string().describe('Street address line 1'),
        address2:    z.string().optional(),
        city:        z.string(),
        province:    z.string().optional().describe('State / province name or code'),
        country:     z.string().describe('ISO 3166-1 alpha-2 country code (e.g. US, GB, AU)'),
        zip:         z.string().describe('Postal / ZIP code'),
      }).describe('Destination address. Only country + zip + city are strictly required for rate calculation.'),
    },
    async ({ token_id, size, color, quantity = 1, shipping_address }) => {
      logTool('get_quote');

      const drop = await getDropByTokenId(token_id);
      if (!drop || drop.brand_id !== brand.id) {
        return { isError: true, content: [{ type: 'text', text: `Product #${token_id} not found for ${brand.name}` }] };
      }

      // Resolve the Shopify variant for this (size, colour) selection.
      const variants = await getVariantsBySubmissionId(drop.id);
      const hasSizeAxis  = variants.some(v => v.size  != null);
      const hasColorAxis = variants.some(v => v.color != null);
      const distinctSizes  = Array.from(new Set(variants.map(v => v.size).filter(Boolean))) as string[];
      const distinctColors = Array.from(new Set(variants.map(v => v.color).filter(Boolean))) as string[];

      let matchVariant = variants[0];
      if (variants.length > 1) {
        const matchingRows = variants.filter(v =>
          (!hasSizeAxis  || !size  || v.size?.toLowerCase()  === size.toLowerCase())
          && (!hasColorAxis || !color || v.color?.toLowerCase() === color.toLowerCase())
        );

        // Required-axis enforcement: if the product has an axis with > 1
        // distinct value, the agent must supply that axis to get an exact
        // shipping quote (carrier rates can vary by item weight per variant).
        const sizeRequired  = hasSizeAxis  && distinctSizes.length  > 1 && !size;
        const colorRequired = hasColorAxis && distinctColors.length > 1 && !color;
        if (sizeRequired || colorRequired) {
          const missing: string[] = [];
          if (sizeRequired)  missing.push(`size (available: ${distinctSizes.join(', ')})`);
          if (colorRequired) missing.push(`color (available: ${distinctColors.join(', ')})`);
          return { isError: true, content: [{ type: 'text', text: `${drop.title} has multiple variants. Specify ${missing.join(' and ')} for an accurate shipping quote.` }] };
        }

        if (matchingRows.length === 0) {
          const parts: string[] = [];
          if (size)  parts.push(`size "${size}"`);
          if (color) parts.push(`colour "${color}"`);
          return { isError: true, content: [{ type: 'text', text: `${parts.join(' / ') || 'That variant'} is not available. Sizes: ${distinctSizes.join(', ') || 'n/a'}. Colours: ${distinctColors.join(', ') || 'n/a'}.` }] };
        }
        matchVariant = matchingRows[0];
      }

      // Primary path: Shopify Storefront API via ephemeral cart.
      if (matchVariant?.shopify_variant_id && brand.shopify_domain) {
        const { getShippingQuote } = await import('@/lib/app/shopify-shipping');
        const quote = await getShippingQuote({
          brand,
          shopifyVariantId: matchVariant.shopify_variant_id,
          quantity,
          address: {
            line1:      shipping_address.address1,
            line2:      shipping_address.address2,
            city:       shipping_address.city,
            state:      shipping_address.province,
            postalCode: shipping_address.zip,
            country:    shipping_address.country,
          },
        });

        if (quote.ok && quote.source === 'shopify_storefront' && quote.options.length > 0) {
          const sorted = quote.options.slice().sort((a, b) => a.priceUsd - b.priceUsd);
          return { content: [{ type: 'text', text: JSON.stringify({
            status:   'ok',
            source:   'shopify_storefront_live',
            tokenId:  token_id,
            product:  drop.title,
            size:     matchVariant?.size  ?? 'n/a',
            color:    matchVariant?.color ?? 'n/a',
            quantity,
            shipsTo:  shipping_address.country.toUpperCase(),
            currency: quote.currency,
            rates:    sorted.map(r => ({
              handle:   r.handle,
              title:    r.title,
              priceUsd: r.priceUsd,
            })),
          }, null, 2) }] };
        }

        if (!quote.ok && quote.code === 'no_rates') {
          return { content: [{ type: 'text', text: JSON.stringify({
            status:  'no_rates',
            reason:  'The merchant does not ship to this destination (no rates returned by Shopify).',
            shipsTo: shipping_address.country.toUpperCase(),
            tokenId: token_id,
          }, null, 2) }] };
        }

        // Any other failure mode (no_token, api_error, invalid_address,
        // fallback_zero) falls through to flat-rate below. shopify-shipping
        // already logs the detail when it matters.
      }

      // Fallback: flat-rate config from brand_data.shipping.
      const { getShippingConfig, computeShippingQuote } = await import('@/lib/app/shipping');
      const config = getShippingConfig(brand.brand_data);
      const quote = computeShippingQuote(config, shipping_address.country);

      return { content: [{ type: 'text', text: JSON.stringify({
        status:  quote.status === 'flat_rate' ? 'ok' : quote.status,
        source:  'flat_rate_config',
        tokenId: token_id,
        product: drop.title,
        quote,
      }, null, 2) }] };
    },
  );

  // ── buy_product ────────────────────────────────────────────────────

  server.tool(
    'buy_product',
    `Initiate a purchase for a ${brand.name} product. Returns payment instructions (USDC on Base). For AI agents,  send USDC to the returned address, then confirm at the central /mcp endpoint. Pass size and/or color to pin the variant; required for products that have those axes.`,
    {
      token_id: z.number().describe('The RRG token ID of the product'),
      size: z.string().optional().describe('Size to purchase (e.g. S, M, L, XL). Required when the product has a size axis with multiple values.'),
      color: z.string().optional().describe('Colourway to purchase (e.g. "Modern Chrome", "Brushed Steel"). Required when the product has a colour axis with multiple values; recorded on the order so fulfillment ships the right finish.'),
      buyer_wallet: z.string().describe('Your 0x wallet address on Base'),
    },
    async ({ token_id, size, color, buyer_wallet }) => {
      logTool('buy_product');
      const drop = await getDropByTokenId(token_id);
      if (!drop || drop.brand_id !== brand.id) {
        return { isError: true, content: [{ type: 'text', text: `Product #${token_id} not found for ${brand.name}` }] };
      }

      const variants     = await getVariantsBySubmissionId(drop.id);
      const hasSizeAxis  = variants.some(v => v.size  != null);
      const hasColorAxis = variants.some(v => v.color != null);
      const distinctSizes  = Array.from(new Set(variants.map(v => v.size).filter(Boolean))) as string[];
      const distinctColors = Array.from(new Set(variants.map(v => v.color).filter(Boolean))) as string[];

      // Required-axis enforcement: any axis with more than one distinct value
      // must be specified by the buyer.
      const sizeRequired  = hasSizeAxis  && distinctSizes.length  > 1 && !size;
      const colorRequired = hasColorAxis && distinctColors.length > 1 && !color;
      if (sizeRequired || colorRequired) {
        const missing: string[] = [];
        if (sizeRequired)  missing.push(`size (available: ${distinctSizes.join(', ')})`);
        if (colorRequired) missing.push(`color (available: ${distinctColors.join(', ')})`);
        return { isError: true, content: [{ type: 'text', text: `${drop.title} requires ${missing.join(' and ')}.` }] };
      }

      // Resolve the variant matching whatever the buyer pinned (size or
      // colour or both). Used for the live stock check.
      let matchedVariant = variants[0];
      if (variants.length > 0) {
        const found = variants.find(v =>
          (!hasSizeAxis  || !size  || v.size?.toLowerCase()  === size.toLowerCase())
          && (!hasColorAxis || !color || v.color?.toLowerCase() === color.toLowerCase())
        );
        if ((size || color) && !found) {
          const parts: string[] = [];
          if (size)  parts.push(`size "${size}"`);
          if (color) parts.push(`colour "${color}"`);
          return { isError: true, content: [{ type: 'text', text: `${parts.join(' / ')} not available for ${drop.title}. Sizes: ${distinctSizes.join(', ') || 'n/a'}. Colours: ${distinctColors.join(', ') || 'n/a'}.` }] };
        }
        if (found) {
          matchedVariant = found;
          const stock = await getVariantStock(brand.shopify_domain, matchedVariant);
          if (stock <= 0) {
            const label = [matchedVariant.size, matchedVariant.color].filter(Boolean).join(' / ');
            return { isError: true, content: [{ type: 'text', text: `${label || 'That variant'} is out of stock for ${drop.title}. Try a different size or colour.` }] };
          }
        }
      }

      const price = parseFloat(drop.price_usdc ?? '0');
      const platformWallet = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

      const variantInstructions: string[] = [];
      if (size)  variantInstructions.push(`Size selected: ${size}`);
      if (color) variantInstructions.push(`Colour selected: ${color}`);
      if (variantInstructions.length === 0) {
        variantInstructions.push('No size/colour specified,  include in shipping notes if the product has multiple variants.');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'payment_required',
            tokenId: token_id,
            product: drop.title,
            size:  size  ?? 'not specified',
            color: color ?? 'not specified',
            priceUsdc: price.toFixed(2),
            payTo: platformWallet,
            usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            chainId: 8453,
            chain: 'Base',
            instructions: [
              `Send exactly ${price.toFixed(2)} USDC to ${platformWallet} on Base.`,
              `Then call confirm_agent_purchase on the central /mcp endpoint with tokenId, buyerWallet, txHash${size ? `, selected_size="${size}"` : ''}${color ? `, selected_color="${color}"` : ''}.`,
              ...variantInstructions,
            ],
            centralMcpUrl: `${siteUrl}/mcp`,
          }, null, 2),
        }],
      };
    },
  );

  // ── get_brand_knowledge ────────────────────────────────────────────
  //
  // Surfaces the policy / FAQ / sizing-rules knowledge base maintained in
  // app_seller_memories (written by the admin chat at
  // /admin/sellers/[slug]/concierge and seeded by the
  // scripts/ingest-brand-knowledge.mjs crawler). External A2A consumers
  // can answer "what's the returns window", "what's the sizing rule for
  // jeans", etc. without going through the central chat.

  server.tool(
    'get_brand_knowledge',
    `Look up ${brand.name}'s store policies, FAQs, sizing rules, shipping terms, and other operational knowledge. Pass a query string for fuzzy search, a tag (e.g. "policy:refund", "page:size-guide") to scope to one source, or neither to list all live policy entries. Returns the brand's authoritative entries; treat the returned text as the source of truth and never invent policy details.`,
    {
      query: z.string().optional().describe('Free-text query. When set, runs a fuzzy search across titles and bodies.'),
      tag:   z.string().optional().describe('Filter by a single tag (e.g. "policy:refund", "page:size-guide").'),
      limit: z.number().int().min(1).max(50).optional().describe('Max entries to return (default 20).'),
    },
    async ({ query, tag, limit }) => {
      logTool('get_brand_knowledge');
      const lim = limit ?? 20;

      let rows: Record<string, unknown>[] = [];
      let err: { message: string } | null = null;

      if (query && query.trim().length > 0) {
        const r = await db.rpc('app_seller_memory_search', {
          p_slug:  brand.slug,
          p_query: query.trim(),
          p_limit: lim,
        });
        rows = (r.data ?? []) as Record<string, unknown>[];
        err  = r.error;
      } else {
        const r = await db.rpc('app_seller_memory_list', {
          p_slug:            brand.slug,
          p_type:            tag ? null : 'policy',
          p_tag:             tag ?? null,
          p_include_expired: false,
          p_limit:           lim,
        });
        rows = (r.data ?? []) as Record<string, unknown>[];
        err  = r.error;
      }

      if (err) {
        return { isError: true, content: [{ type: 'text', text: `Knowledge lookup failed: ${err.message}` }] };
      }
      if (rows.length === 0) {
        return {
          content: [{
            type: 'text',
            text: query
              ? `No ${brand.name} knowledge entries match "${query}".`
              : `No ${brand.name} knowledge entries are currently published${tag ? ` for tag "${tag}"` : ''}.`,
          }],
        };
      }

      const entries = rows.map((r) => ({
        type:       r.type,
        title:      r.title,
        body:       r.body,
        tags:       Array.isArray(r.tags) ? r.tags : [],
        structured: r.structured ?? {},
        valid_until: r.valid_until ?? null,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ brand: brand.name, count: entries.length, entries }, null, 2),
        }],
      };
    },
  );

  // Previously we patched every tool's execution.taskSupport to 'optional'
  // here so nanobot task-context clients wouldn't filter them out. MCP SDK
  // 1.27+ validates that taskSupport='optional' requires registerToolTask()
  //,  the naked patch now throws at call time. Nanobot concierges on Box
  // use a local stdio MCP (see mcp-servers/brand-catalogue) rather than
  // this HTTP endpoint, so the patch isn't needed. Leaving tools at their
  // default taskSupport; revisit if a task-context client hits this route.

  return server;
}

// ── Request handler ──────────────────────────────────────────────────

async function handleBrandMcpRequest(
  req: Request,
  brand: RrgBrand,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const accept = req.headers.get('accept') ?? '';
  const normalised =
    accept.includes('text/event-stream') && accept.includes('application/json')
      ? req
      : new Request(req, {
          headers: (() => {
            const h = new Headers(req.headers);
            h.set('accept', 'application/json, text/event-stream');
            return h;
          })(),
        });

  const { agentId, agentWallet } = parseAgentIdentity(req.headers);
  const logTool = (tool: McpToolName, opts?: { completed?: boolean }) => {
    logMcpInteraction({
      sellerId: brand.id,
      toolCalled: tool,
      agentId,
      agentWallet,
      completed: opts?.completed,
    });
  };

  const server = createBrandServer(brand, logTool);
  await server.connect(transport);
  return transport.handleRequest(normalised);
}

// ── Route handlers ───────────────────────────────────────────────────

async function getBrandOrNotFound(req: Request): Promise<{ brand: RrgBrand } | Response> {
  // Extract slug from URL path: /brand/{slug}/mcp
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const sellerIdx = parts.indexOf('brand');
  const slug = sellerIdx >= 0 ? parts[sellerIdx + 1] : null;

  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing brand slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const brand = await getSellerBySlug(slug);
  if (!brand || brand.status !== 'active') {
    return new Response(JSON.stringify({ error: `Brand "${slug}" not found` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { brand };
}

export async function POST(req: Request) {
  const result = await getBrandOrNotFound(req);
  if (result instanceof Response) return result;
  return handleBrandMcpRequest(req, result.brand);
}

export async function DELETE(req: Request) {
  const result = await getBrandOrNotFound(req);
  if (result instanceof Response) return result;
  return handleBrandMcpRequest(req, result.brand);
}

export async function GET(req: Request) {
  const result = await getBrandOrNotFound(req);
  if (result instanceof Response) return result;
  const { brand } = result;

  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('text/event-stream') && accept.includes('application/json')) {
    return handleBrandMcpRequest(req, brand);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';
  return new Response(JSON.stringify({
    name: `${brand.name} on RRG`,
    version: '1.0.0',
    protocol: 'mcp',
    description: brand.headline || brand.description,
    storefront: `${siteUrl}/brand/${brand.slug}`,
    website: brand.website_url,
    tools: [
      {
        name: 'list_products',
        description: `Browse all ${brand.name} listings. Returns full agent-facing payload per item,  agentDescription, styleTags, occasionFit, conditionGrade, authenticationStatus, priceUsdc/priceEur,  so an agent can filter without per-item fan-out.`,
      },
      {
        name: 'get_product',
        description: `Get every detail for one item, including flattened agent-facing fields and full productAttributes JSON.`,
      },
      ...(brand.supports_sizing ? [{
        name: 'get_sizing_guide',
        description: `Size charts and fit notes per category.`,
      }] : []),
      {
        name: 'buy_product',
        description: `Initiate a purchase. Returns USDC payment instructions on Base.`,
      },
      {
        name: 'get_brand_knowledge',
        description: `Look up ${brand.name}'s policies (returns, shipping, sizing rules, FAQ, care). Fuzzy search via query, or filter by tag. Authoritative for store policy questions.`,
      },
    ],
    schemas: {
      product: {
        description: 'Shape returned by list_products items and get_product. Fields populated only after vision-enrichment has run; otherwise null/empty arrays.',
        fields: {
          tokenId: 'integer,  RRG token ID, used as the listing identifier and in get_product / buy_product calls',
          title: 'string,  concise display title',
          brand: 'string,  the brand or maison',
          category: 'string | null,  e.g. handbag, ring, jacket, dress, jeans',
          priceUsdc: 'string. Price in USDC (Base mainnet)',
          priceEur: 'number | null. Original EUR price for curated resale items',
          conditionGrade: 'string | null. Pristine, Excellent, Very Good, Good, Fair',
          authenticationStatus: 'string | null. Provenance/authentication signal set per brand (e.g. third-party authentication, in-house verification)',
          styleTags: 'string[]. Short tags like minimal, structured, monogram, archival',
          occasionFit: 'string[]. Contexts like work, evening, weekend, travel',
          buyerIntentSignals: 'string[]. Phrases a buyer-agent might match (e.g. "investment piece", "classic silhouette")',
          agentDescription: 'string | null. 150-200 word natural-language paragraph for buyer-agent reasoning. The hero field for intent matching.',
          brandContext: 'string | null. What this house represents in the luxury market',
          resaleValueContext: 'string | null. Secondary-market value notes',
          inStock: 'boolean. Derived: true if any variant has stock OR (no variants AND remaining > 0)',
          editionSize: 'integer. Total edition (1 for single-SKU resale items)',
          remaining: 'integer. Units still available',
          ecommerceUrl: 'string | null. Provenance link to the source listing',
          rrgUrl: 'string. RRG listing page URL',
        },
      },
    },
    connect: `POST ${siteUrl}/brand/${brand.slug}/mcp`,
  }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
