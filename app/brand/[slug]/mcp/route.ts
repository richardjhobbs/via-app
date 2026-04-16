/**
 * Per-brand MCP endpoint — /brand/{slug}/mcp
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
  getBrandBySlug,
  getApprovedDrops,
  getDropByTokenId,
  getVariantsBySubmissionId,
  getSizingByBrand,
  getSizingByCategory,
  getPurchaseCountsByTokenIds,
  type RrgBrand,
  type RrgProductVariant,
} from '@/lib/rrg/db';
import { getRRGReadOnly } from '@/lib/rrg/contract';

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
      map.set(String(variant.id), Math.max(0, parseInt(variant.inventory_quantity, 10) || 0));
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

function createBrandServer(brand: RrgBrand) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';

  const server = new McpServer(
    {
      name: `${brand.name} on RRG`,
      version: '1.0.0',
    },
    {
      instructions: [
        `# ${brand.name} — Brand Concierge`,
        '',
        `Welcome to the ${brand.name} MCP endpoint on Real Real Genuine.`,
        brand.description ? `\n${brand.description}\n` : '',
        'This endpoint provides brand-scoped tools for browsing products,',
        'checking live stock and sizing, and purchasing.',
        '',
        '## Available Tools',
        '- `list_products` — Browse all products from this brand',
        '- `get_product` — Get full details including live stock per size/variant',
        brand.supports_sizing ? '- `get_sizing_guide` — Size charts and fit advice' : '',
        '- `buy_product` — Initiate a purchase (returns payment instructions)',
        '',
        `Storefront: ${siteUrl}/brand/${brand.slug}`,
        brand.website_url ? `Website: ${brand.website_url}` : '',
      ].filter(Boolean).join('\n'),
    },
  );

  // ── list_products ──────────────────────────────────────────────────

  server.tool(
    'list_products',
    `List all products from ${brand.name}. Returns title, price, available sizes, and stock status.`,
    {},
    async () => {
      const drops = await getApprovedDrops(brand.id);
      if (drops.length === 0) {
        return { content: [{ type: 'text', text: `No products listed for ${brand.name} yet.` }] };
      }

      const tokenIds = drops.map(d => d.token_id).filter((id): id is number => id != null);
      const purchaseCounts = await getPurchaseCountsByTokenIds(tokenIds);

      const products = await Promise.all(drops.map(async (drop) => {
        const variants = await getVariantsBySubmissionId(drop.id);
        const sold = purchaseCounts.get(drop.token_id!) ?? 0;
        const remaining = drop.edition_size - sold;

        // Enrich variants with live stock
        const enrichedVariants = await Promise.all(
          variants.map(async (v) => {
            const stock = await getVariantStock(brand.shopify_domain, v);
            return {
              size: v.size,
              color: v.color,
              inStock: stock > 0,
              stock,
              priceOverride: v.price_override,
            };
          })
        );

        const availableSizes = enrichedVariants
          .filter(v => v.inStock)
          .map(v => v.size)
          .filter(Boolean);

        return {
          tokenId: drop.token_id,
          title: drop.title,
          description: drop.description?.slice(0, 200),
          priceUsdc: drop.price_usdc,
          editionSize: drop.edition_size,
          remaining,
          availableSizes,
          totalVariants: variants.length,
          inStockVariants: enrichedVariants.filter(v => v.inStock).length,
          isPhysical: drop.is_physical_product,
          ecommerceUrl: drop.ecommerce_url,
          rrgUrl: `${siteUrl}/rrg/drop/${drop.token_id}`,
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
    `Get full product details including live stock per size/color variant. Use this to check availability before purchasing.`,
    {
      token_id: z.number().describe('The RRG token ID of the product'),
    },
    async ({ token_id }) => {
      const drop = await getDropByTokenId(token_id);
      if (!drop || drop.brand_id !== brand.id) {
        return { isError: true, content: [{ type: 'text', text: `Product #${token_id} not found for ${brand.name}` }] };
      }

      const variants = await getVariantsBySubmissionId(drop.id);
      const counts = await getPurchaseCountsByTokenIds([token_id]);
      const sold = counts.get(token_id) ?? 0;

      const enrichedVariants = await Promise.all(
        variants.map(async (v) => {
          const stock = await getVariantStock(brand.shopify_domain, v);
          return {
            size: v.size,
            color: v.color,
            sku: v.sku,
            inStock: stock > 0,
            stock,
            priceOverride: v.price_override ? `${v.price_override}` : null,
          };
        })
      );

      const result = {
        tokenId: drop.token_id,
        title: drop.title,
        description: drop.description,
        priceUsdc: drop.price_usdc,
        editionSize: drop.edition_size,
        sold,
        remaining: drop.edition_size - sold,
        isPhysical: drop.is_physical_product,
        ecommerceUrl: drop.ecommerce_url,
        rrgUrl: `${siteUrl}/rrg/drop/${drop.token_id}`,
        variants: enrichedVariants,
        sizesInStock: enrichedVariants.filter(v => v.inStock).map(v => v.size).filter(Boolean),
        sizesOutOfStock: enrichedVariants.filter(v => !v.inStock).map(v => v.size).filter(Boolean),
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

  // ── buy_product ────────────────────────────────────────────────────

  server.tool(
    'buy_product',
    `Initiate a purchase for a ${brand.name} product. Returns payment instructions (USDC on Base). For AI agents — send USDC to the returned address, then confirm at the central /mcp endpoint.`,
    {
      token_id: z.number().describe('The RRG token ID of the product'),
      size: z.string().optional().describe('Size to purchase (e.g. S, M, L, XL)'),
      buyer_wallet: z.string().describe('Your 0x wallet address on Base'),
    },
    async ({ token_id, size, buyer_wallet }) => {
      const drop = await getDropByTokenId(token_id);
      if (!drop || drop.brand_id !== brand.id) {
        return { isError: true, content: [{ type: 'text', text: `Product #${token_id} not found for ${brand.name}` }] };
      }

      // Check size availability if specified
      if (size) {
        const variants = await getVariantsBySubmissionId(drop.id);
        const sizeVariant = variants.find(v => v.size?.toLowerCase() === size.toLowerCase());
        if (!sizeVariant) {
          const available = variants.map(v => v.size).filter(Boolean);
          return { isError: true, content: [{ type: 'text', text: `Size "${size}" not available. Available sizes: ${available.join(', ')}` }] };
        }
        const stock = await getVariantStock(brand.shopify_domain, sizeVariant);
        if (stock <= 0) {
          return { isError: true, content: [{ type: 'text', text: `Size "${size}" is out of stock for ${drop.title}. Try a different size.` }] };
        }
      }

      const price = parseFloat(drop.price_usdc ?? '0');
      const platformWallet = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'payment_required',
            tokenId: token_id,
            product: drop.title,
            size: size ?? 'not specified',
            priceUsdc: price.toFixed(2),
            payTo: platformWallet,
            usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            chainId: 8453,
            chain: 'Base',
            instructions: [
              `Send exactly ${price.toFixed(2)} USDC to ${platformWallet} on Base.`,
              'Then call confirm_agent_purchase on the central /mcp endpoint with tokenId, buyerWallet, and txHash.',
              size ? `Size selected: ${size}` : 'No size specified — include size in shipping notes.',
            ],
            centralMcpUrl: `${siteUrl}/mcp`,
          }, null, 2),
        }],
      };
    },
  );

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

  const server = createBrandServer(brand);
  await server.connect(transport);
  return transport.handleRequest(normalised);
}

// ── Route handlers ───────────────────────────────────────────────────

async function getBrandOrNotFound(req: Request): Promise<{ brand: RrgBrand } | Response> {
  // Extract slug from URL path: /brand/{slug}/mcp
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const brandIdx = parts.indexOf('brand');
  const slug = brandIdx >= 0 ? parts[brandIdx + 1] : null;

  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing brand slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const brand = await getBrandBySlug(slug);
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
      'list_products',
      'get_product',
      ...(brand.supports_sizing ? ['get_sizing_guide'] : []),
      'buy_product',
    ],
    connect: `POST ${siteUrl}/brand/${brand.slug}/mcp`,
  }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
