/**
 * lib/squarespace/products-json.ts
 *
 * Fetches a Squarespace shop page via the undocumented `?format=json` query
 * and normalizes products into the same shape as lib/shopify/products-json.ts
 * so the existing brand-mirror.mjs pipeline can consume either source.
 *
 * Endpoint example:
 *   GET https://www.passportadv.com/shop-1?format=json
 *
 * Notes:
 *   - No auth. Works on any Squarespace site unless the owner has disabled
 *     developer mode / JSON view (rare).
 *   - Unstable contract: Squarespace can change this shape at any time.
 *   - Pagination: shop pages return up to ~60 items by default. For larger
 *     catalogues, Squarespace uses `?format=json&offset=<timestamp_ms>` where
 *     the offset is the addedOn of the last item in the previous page.
 */

import type { ShopifyProduct, ShopifyVariant, ShopifyImage } from '../shopify/products-json';

interface SqsVariant {
  id: string;
  sku: string | null;
  price: number;          // cents
  salePrice: number;      // cents, 0 if not on sale
  priceMoney?: { currency: string; value: string };
  onSale: boolean;
  unlimited: boolean;     // true = always available
  qtyInStock: number;
  attributes?: Record<string, string>;
}

interface SqsImage {
  id: string;
  assetUrl: string;
  filename?: string;
  displayIndex: number;
}

interface SqsItem {
  id: string;
  urlId: string;          // slug — e.g. "adv-tee-nckja"
  fullUrl: string;        // e.g. "/shop-1/adv-tee-nckja"
  title: string;
  body: string | null;    // HTML
  excerpt: string | null;
  tags?: string[];
  categories?: string[];
  assetUrl?: string;      // fallback hero image
  productType?: number;   // 1 = physical, 2 = digital, 3 = service
  structuredContent?: {
    variants?: SqsVariant[];
    productType?: number;
  };
  items?: SqsImage[];     // image children
  addedOn: number;
}

interface SqsShopResponse {
  collection?: { title?: string; type?: number };
  items?: SqsItem[];
  pagination?: { nextPage?: boolean; nextPageOffset?: number; nextPageUrl?: string };
}

/** Parse a full shop URL (e.g. `https://site.com/shop-1`) into {origin, path}. */
function parseShopUrl(shopUrl: string): { origin: string; path: string } {
  const u = new URL(shopUrl);
  return { origin: u.origin, path: u.pathname.replace(/\/$/, '') };
}

/** Fetch one page of the shop JSON. */
async function fetchShopPage(shopUrl: string, offset?: number): Promise<SqsShopResponse> {
  const { origin, path } = parseShopUrl(shopUrl);
  const sep = path.includes('?') ? '&' : '?';
  const offsetPart = offset ? `&offset=${offset}` : '';
  const url = `${origin}${path}${sep}format=json${offsetPart}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RRG-Mirror/2.0', 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Squarespace ${res.status} on ${url}`);
  return res.json() as Promise<SqsShopResponse>;
}

/** Normalize a Squarespace item → ShopifyProduct shape. */
function normalizeItem(item: SqsItem, origin: string): ShopifyProduct {
  const sqsVariants = item.structuredContent?.variants ?? [];

  const variants: ShopifyVariant[] = sqsVariants.map((v, idx) => {
    const attrLabel = v.attributes
      ? Object.values(v.attributes).join(' / ')
      : 'Default';
    const priceUsd = (v.price / 100).toFixed(2);
    return {
      id: 0, // Shopify shape uses number; Squarespace uses UUIDs. Use position instead.
      title: attrLabel || 'Default',
      price: priceUsd,
      compare_at_price: v.salePrice && v.salePrice > 0 && v.salePrice < v.price
        ? (v.price / 100).toFixed(2)
        : null,
      sku: v.sku,
      available: v.unlimited || v.qtyInStock > 0,
      position: idx + 1,
    };
  });

  // No variants defined on Squarespace = single-variant product. Fabricate one
  // from the item-level price so downstream code never sees zero variants.
  if (variants.length === 0) {
    variants.push({
      id: 0,
      title: 'Default',
      price: '0.00',
      compare_at_price: null,
      sku: null,
      available: true,
      position: 1,
    });
  }

  const imageList: SqsImage[] = (item.items ?? []).filter(i => i.assetUrl);
  const images: ShopifyImage[] = imageList.length
    ? imageList
        .sort((a, b) => a.displayIndex - b.displayIndex)
        .map((img, idx) => ({
          id: 0,
          src: img.assetUrl,
          width: 0,
          height: 0,
          position: idx + 1,
        }))
    : item.assetUrl
      ? [{ id: 0, src: item.assetUrl, width: 0, height: 0, position: 1 }]
      : [];

  return {
    id: 0,
    title: item.title,
    handle: item.urlId,
    body_html: item.body ?? item.excerpt ?? null,
    vendor: null,
    product_type: null,
    tags: item.tags ?? [],
    variants,
    images,
  };
}

/**
 * Fetch all products from a Squarespace shop URL, paginating via the
 * `nextPageOffset` cursor Squarespace returns.
 */
export async function fetchSquarespaceProducts(
  shopUrl: string,
  { maxPages = 20 }: { maxPages?: number } = {},
): Promise<ShopifyProduct[]> {
  const { origin } = parseShopUrl(shopUrl);
  const all: ShopifyProduct[] = [];
  let offset: number | undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchShopPage(shopUrl, offset);
    const items = data.items ?? [];
    for (const item of items) all.push(normalizeItem(item, origin));
    if (!data.pagination?.nextPage || !data.pagination?.nextPageOffset) break;
    offset = data.pagination.nextPageOffset;
  }
  return all;
}
