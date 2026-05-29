/**
 * Shipping-config helpers for the per-seller MCP endpoint and the
 * /admin/shipping editor. Pattern ported from via-brand-onboarding.
 *
 * The config is stored as the top-level jsonb column app_sellers.shipping
 * (migration 0004). Two modes:
 *
 *   - flat_rate: ships-from country, flat USD rates for domestic and
 *     international, optional excluded-countries list. Applied
 *     uniformly to every product.
 *   - quote_on_purchase: seller responds per-order. Buying agents get a
 *     "pending_merchant_quote" signal and must confirm before settlement.
 *
 * Keys are camelCase in TypeScript (shipsFromCountry, domesticFlatUsd)
 * because that's the wire shape the brand-onboarding repo standardised
 * on. The jsonb is stored with the same camelCase keys to avoid a
 * pointless snake_case ↔ camelCase translation on every read/write.
 *
 * get_shipping_quote on the per-seller MCP uses this to compute the
 * total including shipping before a buying agent initiates payment.
 */

export type ShippingMode = 'flat_rate' | 'quote_on_purchase';

export interface ShippingConfig {
  mode: ShippingMode;
  shipsFromCountry?: string;
  domesticFlatUsd?: number;
  internationalFlatUsd?: number | null;
  excludedCountries?: string[];
  notes?: string;
}

export type ShippingQuote =
  | {
      status: 'flat_rate';
      zone: 'domestic' | 'international';
      costUsd: number;
      shipsFrom: string;
      shipsTo: string;
      notes?: string;
    }
  | {
      status: 'not_shipping_internationally';
      shipsFrom: string;
      shipsTo: string;
    }
  | {
      status: 'country_excluded';
      shipsFrom: string;
      shipsTo: string;
      reason: 'The merchant does not ship to this country.';
    }
  | {
      status: 'pending_merchant_quote';
      notes: string;
    }
  | {
      status: 'not_configured';
      reason: string;
    };

/**
 * Coerce an unknown value (a row's `shipping` jsonb) into a typed
 * ShippingConfig. Returns null if the value is empty/missing — the
 * default for a seller who hasn't configured shipping yet.
 *
 * Unknown keys are dropped; missing keys are left undefined; the
 * mode field is forced into the enum (defaults to flat_rate).
 */
export function getShippingConfig(raw: unknown): ShippingConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  // Empty object = unconfigured.
  if (Object.keys(s).length === 0) return null;
  const mode = s.mode === 'quote_on_purchase' ? 'quote_on_purchase' : 'flat_rate';
  return {
    mode,
    shipsFromCountry:
      typeof s.shipsFromCountry === 'string' ? s.shipsFromCountry : undefined,
    domesticFlatUsd:
      typeof s.domesticFlatUsd === 'number' ? s.domesticFlatUsd : undefined,
    internationalFlatUsd:
      s.internationalFlatUsd === null
        ? null
        : typeof s.internationalFlatUsd === 'number'
          ? s.internationalFlatUsd
          : undefined,
    excludedCountries: Array.isArray(s.excludedCountries)
      ? (s.excludedCountries as unknown[]).filter(
          (c): c is string => typeof c === 'string',
        )
      : [],
    notes: typeof s.notes === 'string' ? s.notes : undefined,
  };
}

/**
 * True iff the config is sufficient to quote shipping.
 *   - quote_on_purchase: always ready (seller will respond manually)
 *   - flat_rate: needs ships-from country + domestic rate
 */
export function isShippingReady(config: ShippingConfig | null | undefined): boolean {
  if (!config) return false;
  if (config.mode === 'quote_on_purchase') return true;
  if (config.mode !== 'flat_rate') return false;
  const hasFromCountry = typeof config.shipsFromCountry === 'string' && config.shipsFromCountry.length === 2;
  const hasDomestic    = typeof config.domesticFlatUsd === 'number' && config.domesticFlatUsd >= 0;
  return hasFromCountry && hasDomestic;
}

const ISO2_RE = /^[A-Z]{2}$/;

/**
 * Validate + normalise a config from a PUT body. Discards unknown
 * fields, clamps numbers to >=0, uppercases ISO codes, trims notes.
 * Always returns a valid ShippingConfig (never throws); the caller is
 * responsible for checking isShippingReady() before treating
 * "configured" as a positive signal.
 */
export function normaliseShipping(input: Partial<ShippingConfig>): ShippingConfig {
  const mode: ShippingMode = input.mode === 'quote_on_purchase' ? 'quote_on_purchase' : 'flat_rate';
  if (mode === 'quote_on_purchase') {
    return {
      mode,
      notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 400) || undefined : undefined,
    };
  }

  const shipsFromCountry = String(input.shipsFromCountry ?? '').trim().toUpperCase().slice(0, 2);

  const domestic =
    typeof input.domesticFlatUsd === 'number' && Number.isFinite(input.domesticFlatUsd)
      ? Math.max(0, input.domesticFlatUsd)
      : undefined;

  const international =
    input.internationalFlatUsd === null
      ? null
      : typeof input.internationalFlatUsd === 'number' && Number.isFinite(input.internationalFlatUsd)
        ? Math.max(0, input.internationalFlatUsd)
        : undefined;

  const excludedCountries = Array.isArray(input.excludedCountries)
    ? input.excludedCountries
        .map((c) => String(c ?? '').trim().toUpperCase().slice(0, 2))
        .filter((c) => ISO2_RE.test(c))
    : [];

  return {
    mode: 'flat_rate',
    shipsFromCountry: ISO2_RE.test(shipsFromCountry) ? shipsFromCountry : undefined,
    domesticFlatUsd: domestic,
    internationalFlatUsd: international,
    excludedCountries,
    notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 400) || undefined : undefined,
  };
}

/**
 * Compute a shipping quote for a given config + buyer country.
 * Accepts ISO 3166-1 alpha-2 code (case-insensitive).
 */
export function computeShippingQuote(
  config: ShippingConfig | null,
  buyerCountryRaw: string | undefined,
): ShippingQuote {
  if (!config) return { status: 'not_configured', reason: 'Shipping is not configured for this brand yet.' };

  if (config.mode === 'quote_on_purchase') {
    return {
      status: 'pending_merchant_quote',
      notes:
        config.notes ??
        'The merchant quotes shipping per order. After you call buy_product they will confirm the total before dispatch.',
    };
  }

  const shipsFrom = (config.shipsFromCountry ?? '').toUpperCase();
  const shipsTo = (buyerCountryRaw ?? '').toUpperCase().slice(0, 2);

  if (!shipsFrom) {
    return { status: 'not_configured', reason: 'Shipping is not configured for this brand yet.' };
  }
  if (!shipsTo) {
    return { status: 'not_configured', reason: 'Missing buyer_country. Pass a 2-letter ISO code.' };
  }

  const excluded = (config.excludedCountries ?? []).map((c) => c.toUpperCase());
  if (excluded.includes(shipsTo)) {
    return {
      status: 'country_excluded',
      shipsFrom,
      shipsTo,
      reason: 'The merchant does not ship to this country.',
    };
  }

  const isDomestic = shipsTo === shipsFrom;
  const rate = isDomestic
    ? config.domesticFlatUsd
    : config.internationalFlatUsd;

  if (rate === null) {
    return { status: 'not_shipping_internationally', shipsFrom, shipsTo };
  }
  if (typeof rate !== 'number' || rate < 0) {
    return { status: 'not_configured', reason: 'Shipping rate missing for this zone.' };
  }

  return {
    status: 'flat_rate',
    zone: isDomestic ? 'domestic' : 'international',
    costUsd: rate,
    shipsFrom,
    shipsTo,
    notes: config.notes,
  };
}
