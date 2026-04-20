/**
 * Shipping-config helpers for the per-brand MCP endpoint.
 *
 * A brand's shipping config lives in rrg_brands.brand_data.shipping
 * (written by the onboarding app at via-brand-onboarding). Two modes:
 *
 *   - flat_rate: ships-from country, flat USD rates for domestic and
 *     international, optional excluded-countries list. Applied
 *     uniformly to every product.
 *   - quote_on_purchase: merchant responds per-order. Agents get a
 *     "pending_merchant_quote" signal.
 *
 * get_quote on the per-brand MCP uses this to compute the total
 * including shipping before a buyer agent initiates payment.
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
 * Extract a ShippingConfig from a brand row's brand_data jsonb.
 * Returns null if nothing has been saved yet.
 */
export function getShippingConfig(
  brandData: unknown,
): ShippingConfig | null {
  if (!brandData || typeof brandData !== 'object') return null;
  const bd = brandData as Record<string, unknown>;
  const shipping = bd.shipping;
  if (!shipping || typeof shipping !== 'object') return null;
  const s = shipping as Record<string, unknown>;
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
