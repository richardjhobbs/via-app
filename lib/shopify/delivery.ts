/**
 * lib/shopify/delivery.ts
 *
 * Live shipping-rate + geo-restriction resolver via Shopify Storefront API.
 *
 * Creates a cart with a buyer's delivery address and returns the delivery
 * options Shopify computes for that brand (from its Shipping settings).
 * Empty `delivery_options` = brand does not ship to that destination
 * (enforce as geo-restriction on our checkout side).
 *
 * Headless token scope is all that's required — the Shopify "Headless"
 * channel exposes Cart Delivery without needing Admin API scopes.
 *
 * Env required (per brand):
 *   SHOPIFY_<BRAND>_STOREFRONT_TOKEN   e.g. SHOPIFY_CLOOUDIE_STOREFRONT_TOKEN
 *   SHOPIFY_<BRAND>_DOMAIN             e.g. clooudie.myshopify.com
 *   SHOPIFY_API_VERSION                default '2025-10'
 */

export interface ShippingAddress {
  address1:  string;
  address2?: string;
  city:      string;
  province?: string;
  zip:       string;
  /** ISO 3166-1 alpha-2 country code (US, GB, SG, AU, ...). Required by Shopify. */
  countryCode: string;
  firstName?: string;
  lastName?:  string;
  phone?:     string;
}

export interface ShippingRateOption {
  /** Stable handle we echo back on purchase — used as the chosen-rate ID. */
  handle: string;
  /** Display title, e.g. "Royal Mail Tracked (1-2 Working Days)". */
  title: string;
  /** Cost in the native Shopify currency for this store. */
  amount: number;
  currency_code: string;
  /** SHIPPING | PICK_UP | LOCAL | RETAIL | NONE (from Shopify). */
  delivery_method_type: string;
  /** Raw carrier/code string — matches what Clooudie's fulfilment team expects. */
  code: string | null;
}

export interface ShippingRateResult {
  /** True if Shopify returned at least one delivery option for this address. */
  deliverable: boolean;
  /** All options the buyer can choose from. Empty = cannot ship there. */
  options: ShippingRateOption[];
  /** Echoed address in normalised form, for audit. */
  address: ShippingAddress;
  /** Raw Shopify cart ID, kept in case we want to reuse it. */
  cart_id: string | null;
}

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

export function getBrandShopifyConfig(brandSlug: string): { token: string; domain: string } | null {
  const key = brandSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const token  = process.env[`SHOPIFY_${key}_STOREFRONT_TOKEN`];
  const domain = process.env[`SHOPIFY_${key}_DOMAIN`];
  if (!token || !domain) return null;
  return { token, domain };
}

async function gql<T = unknown>(
  domain: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Storefront-Access-Token': token,
      'Content-Type': 'application/json',
      'User-Agent': 'RRG/1.0',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL: ${body.errors.map(e => e.message).join('; ')}`);
  }
  return body.data as T;
}

/**
 * Resolve shipping rate options for a buyer's address against a brand's
 * Shopify configuration.
 *
 * `variantGid` must be the full Shopify GID of the variant being purchased,
 * e.g. "gid://shopify/ProductVariant/47232939753689". We store this per-drop
 * on `rrg_submissions.shopify_variant_gid` during the import.
 */
export async function resolveShippingRates(
  brandSlug: string,
  variantGid: string,
  quantity: number,
  address: ShippingAddress,
): Promise<ShippingRateResult> {
  const cfg = getBrandShopifyConfig(brandSlug);
  if (!cfg) throw new Error(`No Shopify config for brand ${brandSlug}`);

  const mutation = `
    mutation RrgCartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          id
          deliveryGroups(first: 10) {
            edges {
              node {
                deliveryAddress { city province zip countryCode }
                deliveryOptions {
                  handle
                  title
                  estimatedCost { amount currencyCode }
                  deliveryMethodType
                  code
                }
              }
            }
          }
        }
        userErrors { field message code }
      }
    }
  `;

  const data = await gql<{
    cartCreate: {
      cart: { id: string; deliveryGroups: { edges: Array<{ node: {
        deliveryAddress: { city: string; province: string | null; zip: string; countryCode: string };
        deliveryOptions: Array<{ handle: string; title: string; estimatedCost: { amount: string; currencyCode: string } | null; deliveryMethodType: string; code: string | null }>;
      } }> } } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>(cfg.domain, cfg.token, mutation, {
    input: {
      lines: [{ merchandiseId: variantGid, quantity }],
      buyerIdentity: {
        countryCode: address.countryCode,
        deliveryAddressPreferences: [{
          deliveryAddress: {
            address1:  address.address1,
            address2:  address.address2 ?? null,
            city:      address.city,
            province:  address.province ?? null,
            zip:       address.zip,
            country:   countryNameFromCode(address.countryCode),
            firstName: address.firstName ?? 'Buyer',
            lastName:  address.lastName  ?? '',
            phone:     address.phone     ?? null,
          },
        }],
      },
    },
  });

  const userErrors = data.cartCreate.userErrors ?? [];
  if (userErrors.length > 0 && !data.cartCreate.cart) {
    throw new Error(`Shopify cart error: ${userErrors.map(e => e.message).join('; ')}`);
  }

  const cart = data.cartCreate.cart;
  const groups = cart?.deliveryGroups?.edges ?? [];
  const options: ShippingRateOption[] = [];
  for (const g of groups) {
    for (const opt of g.node.deliveryOptions ?? []) {
      options.push({
        handle:               opt.handle,
        title:                opt.title,
        amount:               opt.estimatedCost ? parseFloat(opt.estimatedCost.amount) : 0,
        currency_code:        opt.estimatedCost?.currencyCode ?? 'USD',
        delivery_method_type: opt.deliveryMethodType,
        code:                 opt.code,
      });
    }
  }

  return {
    deliverable: options.length > 0,
    options,
    address,
    cart_id: cart?.id ?? null,
  };
}

/**
 * Fetch the first variant GID for a product handle from a brand's Shopify
 * Storefront API. Used during the catalogue import to persist the GID so we
 * never have to re-resolve it per-checkout.
 */
export async function fetchFirstVariantGid(
  brandSlug: string,
  productHandle: string,
): Promise<string | null> {
  const cfg = getBrandShopifyConfig(brandSlug);
  if (!cfg) return null;

  const q = `query($handle: String!) {
    productByHandle(handle: $handle) {
      variants(first: 1) { edges { node { id } } }
    }
  }`;
  const data = await gql<{ productByHandle: { variants: { edges: Array<{ node: { id: string } }> } } | null }>(
    cfg.domain,
    cfg.token,
    q,
    { handle: productHandle },
  );
  return data.productByHandle?.variants?.edges?.[0]?.node?.id ?? null;
}

// ─── Country code → name (Shopify expects the country field as a name) ──
// Minimal set we'll ship with; any extra country Shopify rejects will surface
// as a userError we propagate.
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',      GB: 'United Kingdom',     CA: 'Canada',
  AU: 'Australia',          NZ: 'New Zealand',        IE: 'Ireland',
  FR: 'France',             DE: 'Germany',            ES: 'Spain',
  IT: 'Italy',              NL: 'Netherlands',        BE: 'Belgium',
  SE: 'Sweden',             NO: 'Norway',             DK: 'Denmark',
  FI: 'Finland',            PL: 'Poland',             PT: 'Portugal',
  AT: 'Austria',            CH: 'Switzerland',        JP: 'Japan',
  KR: 'South Korea',        SG: 'Singapore',          HK: 'Hong Kong SAR',
  TW: 'Taiwan',             MY: 'Malaysia',           TH: 'Thailand',
  ID: 'Indonesia',          PH: 'Philippines',        VN: 'Vietnam',
  IN: 'India',              AE: 'United Arab Emirates', SA: 'Saudi Arabia',
  IL: 'Israel',             ZA: 'South Africa',       BR: 'Brazil',
  MX: 'Mexico',             AR: 'Argentina',          CL: 'Chile',
  CO: 'Colombia',           PE: 'Peru',               TR: 'Turkey',
  GR: 'Greece',             CZ: 'Czech Republic',     HU: 'Hungary',
  RO: 'Romania',            SK: 'Slovakia',           SI: 'Slovenia',
  EE: 'Estonia',            LV: 'Latvia',             LT: 'Lithuania',
  LU: 'Luxembourg',         MT: 'Malta',              CY: 'Cyprus',
  BG: 'Bulgaria',           HR: 'Croatia',            IS: 'Iceland',
};
function countryNameFromCode(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}
