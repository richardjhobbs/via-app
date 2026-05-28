/**
 * lib/app/fx.ts
 *
 * USDC conversion rate lookup. Used by Shopify + Squarespace catalogue
 * sync flows to convert seller-storefront prices into USDC.
 *
 * Pattern ported from RRG's scripts/brand-mirror.mjs getUsdcRate():
 *   USD → 1.0 (no conversion)
 *   anything else → frankfurter.app live rate × 1.03 (buyer covers a
 *                   3% spread so currency drift doesn't underprice).
 *
 * Throws if the oracle is unreachable and no static fallback is
 * supplied. Silent zero-pricing would be worse than a sync failure.
 */

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const FX_SPREAD = 1.03; // +3% — buyer pays this premium to absorb FX drift
const FETCH_TIMEOUT_MS = 10_000;

export interface UsdcRate {
  rate:           number;  // multiply native price by this to get USDC equivalent
  spreadApplied:  number;  // the spread multiplier used (1 for USD, FX_SPREAD otherwise)
  source:         'native_usd' | 'frankfurter' | 'static_fallback';
  note:           string;  // human-readable provenance, surface in sync result for debugging
  fetchedAt?:     string;  // ISO date from the oracle response (if applicable)
}

/**
 * Resolve the multiplier to convert a price in `currency` into USDC.
 * USD is treated as 1:1 (USDC is USD-pegged).
 *
 * @param currency       ISO 4217 3-letter code, case-insensitive
 * @param staticFallback Optional manual rate to use if the oracle fails.
 *                       If both the oracle and this fallback are unset,
 *                       the function throws — pricing must never silently
 *                       degrade to zero or stale values.
 */
export async function getUsdcRate(
  currency: string | null | undefined,
  staticFallback?: number,
): Promise<UsdcRate> {
  const cur = String(currency ?? 'USD').toUpperCase().trim();
  if (cur === 'USD') {
    return { rate: 1, spreadApplied: 1, source: 'native_usd', note: 'USD native 1:1' };
  }

  try {
    const ctl = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const res = await fetch(`${FRANKFURTER_URL}?from=${encodeURIComponent(cur)}&to=USD`, { signal: ctl, cache: 'no-store' });
    if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
    const j = await res.json() as { rates?: { USD?: number }; date?: string };
    const mkt = Number(j?.rates?.USD);
    if (!Number.isFinite(mkt) || mkt <= 0) {
      throw new Error(`no USD rate for ${cur} in oracle response`);
    }
    const rate = mkt * FX_SPREAD;
    return {
      rate,
      spreadApplied: FX_SPREAD,
      source: 'frankfurter',
      note: `${cur}→USD ${mkt} (frankfurter.app ${j.date ?? 'latest'}) ×${FX_SPREAD} spread = ${rate.toFixed(6)}`,
      fetchedAt: j.date,
    };
  } catch (e) {
    if (typeof staticFallback === 'number' && Number.isFinite(staticFallback) && staticFallback > 0) {
      return {
        rate:          staticFallback,
        spreadApplied: 1,
        source:        'static_fallback',
        note:          `FX oracle failed (${e instanceof Error ? e.message : String(e)}); used static fallback ${staticFallback}`,
      };
    }
    throw new Error(
      `USDC rate unresolved for ${cur}: FX oracle failed (${e instanceof Error ? e.message : String(e)}) and no static fallback supplied. Aborting to avoid mispricing.`,
    );
  }
}

/**
 * Convert a price in native currency (decimal float like 12.50) to USDC
 * minor units (6dp integer) using the given rate.
 */
export function priceToUsdcMinor(nativePrice: number, rate: number): number {
  if (!Number.isFinite(nativePrice) || nativePrice < 0) {
    throw new Error(`priceToUsdcMinor: invalid native price ${nativePrice}`);
  }
  return Math.round(nativePrice * rate * 1_000_000);
}
