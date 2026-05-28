/**
 * lib/squarespace/products-json.ts
 *
 * Fetches a Squarespace shop page via the undocumented `?format=json`
 * query and normalises items into the same ShopifyProduct shape as
 * lib/shopify/products-json.ts so the catalogue import pipeline can
 * consume either source.
 *
 * Endpoint example:
 *   GET https://www.passportadv.com/shop-1?format=json
 *
 * Notes:
 *   - No auth. Works on any Squarespace site unless the owner has
 *     disabled developer mode / JSON view (rare).
 *   - Unstable contract: Squarespace can change this shape at any
 *     time. If pages stop normalising, dump a sample response and
 *     re-derive.
 *   - Pagination: shop pages return up to ~60 items by default. For
 *     larger catalogues, Squarespace uses
 *     `?format=json&offset=<timestamp_ms>` where offset is the addedOn
 *     of the last item on the previous page.
 *
 * VIA data-only stance: this port intentionally DROPS the images array
 * from the normalised output. Squarespace items expose hero + child
 * images but VIA does not store or display product photos. The
 * ShopifyProduct.images field stays in the type for compatibility but
 * we return an empty array. See feedback_via_is_data_not_images.md.
 */

import type { ShopifyProduct, ShopifyVariant } from '../shopify/products-json';

interface SqsVariant {
  id:           string;
  sku:          string | null;
  price:        number;        // cents
  salePrice:    number;        // cents, 0 if not on sale
  priceMoney?:  { currency: string; value: string };
  onSale:       boolean;
  unlimited:    boolean;       // true = always available
  qtyInStock:   number;
  attributes?:  Record<string, string>;
}

interface SqsItem {
  id:           string;
  urlId:        string;        // slug, e.g. "adv-tee-nckja"
  fullUrl:      string;        // e.g. "/shop-1/adv-tee-nckja"
  title:        string;
  body:         string | null; // HTML
  excerpt:      string | null;
  tags?:        string[];
  categories?:  string[];
  productType?: number;        // 1 = physical, 2 = digital, 3 = service
  structuredContent?: {
    variants?:    SqsVariant[];
    productType?: number;
  };
  addedOn:      number;
}

interface SqsShopResponse {
  collection?: { title?: string; type?: number };
  items?:      SqsItem[];
  pagination?: { nextPage?: boolean; nextPageOffset?: number; nextPageUrl?: string };
}

function parseShopUrl(shopUrl: string): { origin: string; path: string } {
  const u = new URL(shopUrl);
  return { origin: u.origin, path: u.pathname.replace(/\/$/, '') };
}

async function fetchShopPage(shopUrl: string, offset?: number): Promise<SqsShopResponse> {
  const { origin, path } = parseShopUrl(shopUrl);
  const sep = path.includes('?') ? '&' : '?';
  const offsetPart = offset ? `&offset=${offset}` : '';
  const url = `${origin}${path}${sep}format=json${offsetPart}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VIA-Mirror/1.0', 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Squarespace ${res.status} on ${url}`);
  return res.json() as Promise<SqsShopResponse>;
}

/** Normalise a Squarespace item into the ShopifyProduct shape. Images dropped. */
function normalizeItem(item: SqsItem): ShopifyProduct {
  const sqsVariants = item.structuredContent?.variants ?? [];

  const variants: ShopifyVariant[] = sqsVariants.map((v, idx) => {
    const attrLabel = v.attributes
      ? Object.values(v.attributes).join(' / ')
      : 'Default';
    const priceMajor = (v.price / 100).toFixed(2);
    return {
      id:               0,
      title:            attrLabel || 'Default',
      price:            priceMajor,
      compare_at_price: v.salePrice && v.salePrice > 0 && v.salePrice < v.price
        ? (v.price / 100).toFixed(2)
        : null,
      sku:              v.sku,
      available:        v.unlimited || v.qtyInStock > 0,
      position:         idx + 1,
    };
  });

  // No variants on Squarespace = single-variant product. Fabricate one so
  // downstream code never sees zero variants.
  if (variants.length === 0) {
    variants.push({
      id:               0,
      title:            'Default',
      price:            '0.00',
      compare_at_price: null,
      sku:              null,
      available:        true,
      position:         1,
    });
  }

  return {
    id:           0,
    title:        item.title,
    handle:       item.urlId,
    body_html:    item.body ?? item.excerpt ?? null,
    vendor:       null,
    product_type: null,
    tags:         item.tags ?? [],
    variants,
    images:       [], // VIA is data-only — images intentionally dropped
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
  const all: ShopifyProduct[] = [];
  let offset: number | undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchShopPage(shopUrl, offset);
    const items = data.items ?? [];
    for (const item of items) all.push(normalizeItem(item));
    if (!data.pagination?.nextPage || !data.pagination?.nextPageOffset) break;
    offset = data.pagination.nextPageOffset;
  }
  return all;
}

/**
 * Per-variant available stock count, used to summate totalStock on a
 * Squarespace product. Squarespace exposes `qtyInStock` and `unlimited`
 * directly, unlike Shopify's public /products.json which only gives a
 * boolean per variant.
 */
export function squarespaceVariantStock(v: SqsVariant): number {
  if (v.unlimited) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Number(v.qtyInStock) || 0);
}
