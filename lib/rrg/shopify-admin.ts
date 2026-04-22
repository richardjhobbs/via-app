/**
 * Shopify Admin API helpers for server-side shipping + order operations.
 *
 * Unlike the public products.json endpoint (used by brand-mirror.mjs), this
 * module requires a per-brand Admin API token stored in
 * rrg_brands.shopify_storefront_token_encrypted. (Column is named "storefront"
 * for historical reasons; it holds whichever Shopify token the brand
 * provisioned. Admin vs. Storefront is detected by the "shpat_" prefix via
 * isAdminToken(). In dev the value is prefixed with "plaintext:" to make
 * the storage mode explicit.)
 *
 * Shopify Admin tokens have broad scope. RRG only uses the subset required for
 * shipping quotes and optional draft-order creation — read_shipping,
 * write_draft_orders. Tokens should be stored in the DB, never committed.
 *
 * The canonical domain for Admin API calls is <shop>.myshopify.com, not the
 * vanity domain. When the vanity domain issues a 301 to the canonical we
 * follow it automatically; cache the redirect resolution per brand call.
 */

import type { RrgBrand } from './db';

const ADMIN_API_VERSION = '2024-10';

/**
 * Resolve the Shopify API token stored on a brand row. Returns null if the
 * brand has no token provisioned, or if the stored value is an encrypted
 * blob we can't currently decrypt (see the `plaintext:` dev convention in
 * shopify-shipping.ts).
 */
export function resolveShopifyToken(brand: RrgBrand): string | null {
  const raw = brand.shopify_storefront_token_encrypted;
  if (!raw) return null;
  if (raw.startsWith('plaintext:')) return raw.slice('plaintext:'.length);
  // TODO: real decryption (AES-GCM via RRG_ENCRYPTION_KEY) once provisioning
  // writes encrypted blobs. Until then we accept plaintext: only.
  return null;
}

export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  province_code?: string;
  country: string;       // full country name OR 2-letter code
  country_code?: string; // ISO 3166-1 alpha-2
  zip: string;
  phone?: string;
}

export interface ShopifyLineItem {
  variant_id: number | string;
  quantity: number;
}

export interface ShopifyShippingRate {
  handle: string;
  title: string;
  price: string;            // decimal string, matches Shopify response
  price_usd: number;        // parsed for convenience
  markup?: string;
  original_price?: string;
  currency_code?: string;
  phone_required?: boolean;
  delivery_date?: string | null;
  delivery_range?: [string, string] | null;
  delivery_days?: number[];
  min_delivery_date?: string | null;
  max_delivery_date?: string | null;
  source?: string;
}

interface DraftOrderResponse {
  draft_order: {
    id: number;
    invoice_url?: string;
  };
}

interface ShippingRatesResponse {
  shipping_rates: Array<{
    handle: string;
    price: string;
    title: string;
    checkout?: { total_price: string };
    phone_required?: boolean;
    delivery_date?: string | null;
    delivery_range?: [string, string] | null;
    delivery_days?: number[];
    min_delivery_date?: string | null;
    max_delivery_date?: string | null;
    markup?: string;
    source?: string;
  }>;
}

/**
 * Resolve a shop domain to the canonical myshopify.com form.
 * Vanity domains (e.g. shop.unknownunion.com) issue a 301 to
 * unknown-union-shop.myshopify.com for Admin API calls — cache the target
 * within the process so we don't pay the redirect cost twice.
 */
const canonicalCache = new Map<string, string>();

async function resolveCanonicalDomain(domain: string): Promise<string> {
  const cached = canonicalCache.get(domain);
  if (cached) return cached;

  // Fast path — domain is already myshopify.com
  if (domain.endsWith('.myshopify.com')) {
    canonicalCache.set(domain, domain);
    return domain;
  }

  // Probe with a lightweight HEAD and follow the redirect target.
  const res = await fetch(`https://${domain}/admin/api/${ADMIN_API_VERSION}/shop.json`, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });

  if (res.status === 301 || res.status === 302) {
    const loc = res.headers.get('location');
    if (loc) {
      try {
        const url = new URL(loc);
        canonicalCache.set(domain, url.hostname);
        return url.hostname;
      } catch {
        // fall through
      }
    }
  }

  // No redirect — assume domain is already canonical
  canonicalCache.set(domain, domain);
  return domain;
}

async function adminFetch<T>(
  domain: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const canonical = await resolveCanonicalDomain(domain);
  const url = `https://${canonical}/admin/api/${ADMIN_API_VERSION}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type':           'application/json',
      Accept:                   'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 403 = scope missing. Surface as a typed error so callers can swap to
    // the flat-rate fallback without polluting logs with stack traces.
    if (res.status === 403) {
      const err = new Error(`Shopify scope missing for ${path}: ${body.slice(0, 200)}`);
      (err as Error & { code?: string }).code = 'SHOPIFY_SCOPE_MISSING';
      throw err;
    }
    throw new Error(`Shopify ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

/**
 * True iff the error originated from insufficient Admin API scopes.
 * Callers (e.g. the per-brand MCP get_quote tool) can use this to fall
 * through to flat-rate config without noisy logs.
 */
export function isShopifyScopeMissing(err: unknown): boolean {
  return !!(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'SHOPIFY_SCOPE_MISSING');
}

/**
 * Fetch shipping rates for a given line-item set + destination, using
 * Shopify's own rate engine via the draft-orders endpoint. The draft order
 * is deleted immediately after — no order record is retained.
 *
 * This uses the real merchant-configured zones/rates (price-based,
 * weight-based, carrier-calculated) rather than reimplementing the matching
 * logic.
 */
export async function getShopifyShippingRates(
  domain: string,
  token: string,
  lineItems: ShopifyLineItem[],
  address: ShopifyAddress,
): Promise<ShopifyShippingRate[]> {
  if (lineItems.length === 0) {
    throw new Error('getShopifyShippingRates: no line items');
  }

  // 1. Create draft order
  const draftPayload = {
    draft_order: {
      line_items: lineItems.map((li) => ({
        variant_id: li.variant_id,
        quantity:   li.quantity,
      })),
      shipping_address: address,
      // Draft is never invoiced; keep it tagged so it's easy to audit/delete.
      tags: 'rrg-shipping-quote',
      use_customer_default_address: false,
    },
  };

  const draft = await adminFetch<DraftOrderResponse>(domain, token, '/draft_orders.json', {
    method: 'POST',
    body:   JSON.stringify(draftPayload),
  });
  const draftId = draft.draft_order.id;

  try {
    // 2. Fetch rates against this draft's shipping address
    const rates = await adminFetch<ShippingRatesResponse>(
      domain,
      token,
      `/draft_orders/${draftId}/shipping_rates.json`,
    );

    return (rates.shipping_rates ?? []).map((r) => ({
      handle:             r.handle,
      title:              r.title,
      price:              r.price,
      price_usd:          parseFloat(r.price),
      markup:             r.markup,
      original_price:     r.checkout?.total_price,
      phone_required:     r.phone_required,
      delivery_date:      r.delivery_date ?? null,
      delivery_range:     r.delivery_range ?? null,
      delivery_days:      r.delivery_days ?? [],
      min_delivery_date:  r.min_delivery_date ?? null,
      max_delivery_date:  r.max_delivery_date ?? null,
      source:             r.source,
    }));
  } finally {
    // 3. Always clean up the draft — swallow errors so a rate fetch that
    //    succeeded isn't lost to a stray delete failure.
    try {
      await adminFetch(domain, token, `/draft_orders/${draftId}.json`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn(`[shopify-admin] failed to delete draft ${draftId}:`, err);
    }
  }
}

/**
 * Detect whether a token looks like a Shopify Admin token (shpat_…) vs.
 * a Storefront token (opaque hex). The MCP can route differently based on
 * which token a brand has registered.
 */
export function isAdminToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith('shpat_');
}
