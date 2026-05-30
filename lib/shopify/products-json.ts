/**
 * lib/shopify/products-json.ts
 *
 * Thin fetch wrapper for Shopify's public products.json endpoint.
 * No auth required — works on most Shopify stores by default.
 *
 * Used by scripts/clooudie-mirror.mjs to mirror the Clooudie catalogue
 * into RRG as brand-owned listings.
 */

export interface ShopifyVariant {
  id: number;
  title: string;
  price: string;            // e.g. "15.00"
  compare_at_price: string | null;
  sku: string | null;
  available: boolean;
  position: number;
  /** Real per-variant stock when the source exposes it (Squarespace).
   *  null = unlimited / unknown. Shopify's public /products.json omits this,
   *  so it stays undefined there and stock falls back to the available-count. */
  inventory_quantity?: number | null;
}

export interface ShopifyImage {
  id: number;
  src: string;
  width: number;
  height: number;
  position: number;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  tags: string[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

export async function fetchShopifyProducts(
  domain: string,
  limit = 50,
): Promise<ShopifyProduct[]> {
  const url = `https://${domain}/products.json?limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RRG-Mirror/1.0' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Shopify products.json (${url}) returned ${res.status}`);
  }
  const json = await res.json() as { products?: ShopifyProduct[] };
  return json.products ?? [];
}

/** Strip HTML tags and decode common entities — for short descriptions. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
