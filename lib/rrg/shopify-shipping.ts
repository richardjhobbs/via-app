/**
 * lib/rrg/shopify-shipping.ts
 *
 * Fetches shipping rates from Shopify Storefront API for a given address +
 * variant. Used to calculate shipping cost during RRG checkout so the buyer
 * pays price + shipping in a single USDC transaction.
 *
 * IMPORTANT: This does NOT create orders in Shopify. RRG handles the
 * transaction end-to-end — we only use Shopify as a data source for rates.
 *
 * Requires: rrg_brands.shopify_storefront_token_encrypted (Storefront API token)
 * API docs: https://shopify.dev/docs/api/storefront/latest/objects/Cart
 *
 * Flow:
 *   1. Create an ephemeral cart with the variant
 *   2. Add buyer's shipping address
 *   3. Fetch deliveryOptions — returns available rates
 *   4. Cart is never checked out, just discarded
 *
 * Build status: scaffolded + graceful fallback. When shopify_storefront_token
 * is null on a brand, returns a zero-shipping response so the rest of the
 * checkout still works. Full implementation activates once we have the token.
 */

import { db, type RrgBrand } from './db';

const STOREFRONT_API_VERSION = '2024-10';

// ── Types ────────────────────────────────────────────────────────────

export interface ShippingAddress {
  name?:        string;
  line1:        string;
  line2?:       string;
  city:         string;
  state?:       string;
  postalCode:   string;
  country:      string; // ISO 3166-1 alpha-2 (e.g. "US", "GB", "AU")
  phone?:       string;
}

export interface ShippingRateOption {
  handle:       string;    // Shopify rate handle (e.g. "Standard-4.99")
  title:        string;    // e.g. "Standard", "Express", "DHL 2-3 days"
  priceUsd:     number;    // rate cost in USD
  estimatedDays?: number;  // optional delivery estimate
}

export interface ShippingQuote {
  ok:              true;
  options:         ShippingRateOption[];
  currency:        string;
  fetchedAt:       string;
  source:          'shopify_storefront' | 'fallback_zero';
  cartId?:         string;  // ephemeral — expires in ~24h
}

export interface ShippingQuoteError {
  ok:       false;
  error:    string;
  code:     'no_token' | 'no_variant_id' | 'api_error' | 'no_rates' | 'invalid_address';
}

// ── Token decryption ─────────────────────────────────────────────────

/**
 * Decrypt the Shopify Storefront token stored on the brand row.
 * Uses the same encryption scheme as other RRG secrets. When no token is
 * set, returns null (caller should fall back to zero shipping).
 */
async function decryptStorefrontToken(brand: RrgBrand): Promise<string | null> {
  if (!brand.shopify_storefront_token_encrypted) return null;

  const raw = brand.shopify_storefront_token_encrypted;

  // Dev-mode / pre-encryption path: plaintext tokens are stored with a
  // "plaintext:" prefix. Accept these without requiring RRG_ENCRYPTION_KEY,
  // since there is nothing to decrypt. Real AES-GCM / sodium decryption is
  // still gated on the key below.
  if (raw.startsWith('plaintext:')) {
    return raw.slice('plaintext:'.length);
  }

  const key = process.env.RRG_ENCRYPTION_KEY;
  if (!key) {
    console.warn('[shopify-shipping] RRG_ENCRYPTION_KEY not set, cannot decrypt token');
    return null;
  }

  try {
    // TODO: implement real decryption when encrypted-at-rest provisioning lands.
    console.warn('[shopify-shipping] Encrypted token decryption not yet implemented');
    return null;
  } catch (e) {
    console.error('[shopify-shipping] Token decryption failed:', e);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Get shipping rates for a product variant shipped to an address.
 * Returns a structured quote with options sorted cheapest-first.
 *
 * Fallback: if no Shopify token is configured, returns `source: 'fallback_zero'`
 * with an empty options array. Caller should treat this as "shipping included"
 * or surface an error to the buyer.
 */
export async function getShippingQuote(params: {
  brand:             RrgBrand;
  shopifyVariantId:  string;
  address:           ShippingAddress;
  quantity?:         number;
}): Promise<ShippingQuote | ShippingQuoteError> {
  const { brand, shopifyVariantId, address, quantity = 1 } = params;

  if (!shopifyVariantId) {
    return { ok: false, error: 'No Shopify variant ID for this product', code: 'no_variant_id' };
  }
  if (!brand.shopify_domain) {
    return { ok: false, error: 'Brand is not Shopify-backed', code: 'api_error' };
  }

  const token = await decryptStorefrontToken(brand);
  if (!token) {
    // Graceful fallback — allow checkout to proceed with zero shipping until token is provisioned
    console.log(`[shopify-shipping] No token for ${brand.slug} — returning fallback_zero quote`);
    return {
      ok:        true,
      options:   [],
      currency:  'USD',
      fetchedAt: new Date().toISOString(),
      source:    'fallback_zero',
    };
  }

  const endpoint = `https://${brand.shopify_domain}/api/${STOREFRONT_API_VERSION}/graphql.json`;

  // Create a cart and ask for delivery rates with carrier rates included.
  // `withCarrierRates: true` requires the @defer directive — Shopify returns
  // a multipart/mixed response: an initial part (cart id) and an incremental
  // part (the rates) once carriers have responded. We parse both parts and
  // pluck deliveryGroups out of the deferred patch.
  const createCartQuery = `
    mutation cartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          id
          cost { subtotalAmount { amount currencyCode } }
          ... @defer(label: "rates") {
            deliveryGroups(first: 5, withCarrierRates: true) {
              edges {
                node {
                  deliveryOptions {
                    handle
                    title
                    code
                    estimatedCost { amount currencyCode }
                    deliveryMethodType
                  }
                }
              }
            }
          }
        }
        userErrors { field message code }
      }
    }`;

  // Convert shopifyVariantId to a Storefront GID if it's numeric
  const merchandiseId = shopifyVariantId.startsWith('gid://')
    ? shopifyVariantId
    : `gid://shopify/ProductVariant/${shopifyVariantId}`;

  const input = {
    lines: [{ merchandiseId, quantity }],
    buyerIdentity: {
      countryCode: address.country.toUpperCase(),
      deliveryAddressPreferences: [{
        deliveryAddress: {
          address1:    address.line1,
          address2:    address.line2 ?? '',
          city:        address.city,
          province:    address.state ?? '',
          zip:         address.postalCode,
          country:     address.country.toUpperCase(),
          ...(address.name ? (() => {
            const parts = address.name.trim().split(/\s+/);
            return {
              firstName: parts[0] ?? '',
              lastName:  parts.slice(1).join(' ') || parts[0] || '',
            };
          })() : {}),
          ...(address.phone ? { phone: address.phone } : {}),
        },
      }],
    },
  };

  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':                      'application/json',
        'Accept':                            'multipart/mixed',
        'X-Shopify-Storefront-Access-Token': token,
      },
      body:   JSON.stringify({ query: createCartQuery, variables: { input } }),
      // Carrier rate fetches go to UPS/USPS/FedEx — bumped from 10s to 30s
      // to absorb the slowest carriers without false-failing.
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[shopify-shipping] ${brand.slug} API error ${res.status}:`, text.slice(0, 300));
      return { ok: false, error: `Shopify API error: ${res.status}`, code: 'api_error' };
    }

    // Shopify returns multipart/mixed for @defer queries. Parse both parts
    // and stitch the incremental "rates" patch into the initial cart.
    const raw = await res.text();
    const { cart, errors, userErrors } = parseDeferredCartResponse(raw);

    if (errors.length > 0) {
      console.error(`[shopify-shipping] ${brand.slug} GraphQL errors:`, errors);
      return { ok: false, error: errors[0]?.message ?? 'GraphQL error', code: 'api_error' };
    }
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors[0].message, code: 'invalid_address' };
    }

    const deliveryOptions = cart?.deliveryGroups?.edges?.[0]?.node?.deliveryOptions ?? [];
    if (deliveryOptions.length === 0) {
      return { ok: false, error: 'No shipping rates available to this address', code: 'no_rates' };
    }

    const options: ShippingRateOption[] = deliveryOptions.map((opt: {
      handle:         string;
      title:          string;
      estimatedCost?: { amount: string; currencyCode: string };
    }) => ({
      handle:    opt.handle,
      title:     opt.title,
      priceUsd:  parseFloat(opt.estimatedCost?.amount ?? '0'),
    })).sort((a: ShippingRateOption, b: ShippingRateOption) => a.priceUsd - b.priceUsd);

    const currency = deliveryOptions[0]?.estimatedCost?.currencyCode ?? 'USD';

    return {
      ok:        true,
      options,
      currency,
      fetchedAt: new Date().toISOString(),
      source:    'shopify_storefront',
      cartId:    cart?.id,
    };
  } catch (e) {
    console.error(`[shopify-shipping] ${brand.slug} fetch failed:`, e);
    return {
      ok:    false,
      error: e instanceof Error ? e.message : 'Unknown error',
      code:  'api_error',
    };
  }
}

/**
 * Convenience wrapper: fetch quote by RRG token ID + size + address.
 * Resolves the variant via rrg_product_variants.
 */
export async function getShippingQuoteByToken(params: {
  tokenId:  number;
  size:     string;
  address:  ShippingAddress;
}): Promise<ShippingQuote | ShippingQuoteError> {
  const { tokenId, size, address } = params;

  // Look up submission + brand + matching variant
  const { data: sub } = await db
    .from('rrg_submissions')
    .select('id, brand_id')
    .eq('token_id', tokenId)
    .single();
  if (!sub) return { ok: false, error: 'Product not found', code: 'no_variant_id' };

  const { data: brand } = await db
    .from('rrg_brands')
    .select('*')
    .eq('id', sub.brand_id)
    .single();
  if (!brand) return { ok: false, error: 'Brand not found', code: 'api_error' };

  const { data: variant } = await db
    .from('rrg_product_variants')
    .select('shopify_variant_id')
    .eq('submission_id', sub.id)
    .ilike('size', size)
    .maybeSingle();
  if (!variant?.shopify_variant_id) {
    return { ok: false, error: `No variant found for size "${size}"`, code: 'no_variant_id' };
  }

  return getShippingQuote({
    brand:            brand as RrgBrand,
    shopifyVariantId: variant.shopify_variant_id,
    address,
  });
}

// ── multipart/mixed parser for @defer responses ──────────────────────

interface ParsedCartResult {
  cart: {
    id?: string;
    cost?: { subtotalAmount?: { amount: string; currencyCode: string } };
    deliveryGroups?: {
      edges: Array<{
        node: {
          deliveryOptions: Array<{
            handle:        string;
            title:         string;
            code?:         string;
            estimatedCost?: { amount: string; currencyCode: string };
          }>;
        };
      }>;
    };
  } | null;
  errors:     Array<{ message: string }>;
  userErrors: Array<{ field?: string[]; message: string; code?: string }>;
}

/**
 * Parse Shopify's multipart/mixed @defer response into a single cart shape.
 *
 * The response looks like:
 *   --graphql
 *   Content-Type: application/json
 *   <initial JSON: { data: { cartCreate: { cart: { id, cost } } }, hasNext: true }>
 *
 *   --graphql
 *   Content-Type: application/json
 *   <incremental JSON: { incremental: [{ path: [...], data: { deliveryGroups: ... } }] }>
 *
 *   --graphql--
 *
 * We collect every JSON body, take cart/userErrors/errors from the initial
 * payload, then merge the deferred patch (the deliveryGroups patch) into
 * the cart object. The function tolerates the non-deferred shape too — if
 * Shopify ever returns plain application/json we just read data directly.
 */
function parseDeferredCartResponse(raw: string): ParsedCartResult {
  const result: ParsedCartResult = { cart: null, errors: [], userErrors: [] };

  // Find every JSON object in the body. The simplest robust path: split on
  // the boundary marker (lines starting with --) and parse anything that
  // looks like JSON.
  const segments = raw.split(/\r?\n--/);
  const jsonBlobs: unknown[] = [];
  for (const seg of segments) {
    const start = seg.indexOf('{');
    if (start < 0) continue;
    const candidate = seg.slice(start).trim();
    try {
      jsonBlobs.push(JSON.parse(candidate));
    } catch {
      // Some segments are headers only or trailing boundary — skip silently.
    }
  }

  // Plain JSON response — single object, no boundaries.
  if (jsonBlobs.length === 0) {
    try {
      jsonBlobs.push(JSON.parse(raw));
    } catch {
      return result;
    }
  }

  for (const blob of jsonBlobs) {
    const b = blob as Record<string, unknown>;
    if (Array.isArray(b.errors)) {
      for (const e of b.errors as Array<{ message: string }>) result.errors.push(e);
    }
    const data = b.data as { cartCreate?: { cart?: ParsedCartResult['cart']; userErrors?: ParsedCartResult['userErrors'] } } | undefined;
    if (data?.cartCreate) {
      if (data.cartCreate.cart) {
        result.cart = { ...(result.cart ?? {}), ...data.cartCreate.cart };
      }
      if (Array.isArray(data.cartCreate.userErrors)) {
        for (const ue of data.cartCreate.userErrors) result.userErrors.push(ue);
      }
    }

    // Incremental patch: { incremental: [{ path: [...], data: {...} }] }
    const incremental = b.incremental as Array<{ path?: string[]; data?: Record<string, unknown> }> | undefined;
    if (Array.isArray(incremental)) {
      for (const patch of incremental) {
        if (!patch.data) continue;
        // We only care about patches under cartCreate.cart — merge their
        // fields into the cart object.
        if (!result.cart) result.cart = {};
        Object.assign(result.cart, patch.data);
      }
    }
  }

  return result;
}
