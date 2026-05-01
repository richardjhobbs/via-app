/**
 * Revenue split calculator for multi-brand RRG platform.
 *
 * On-chain contract hardcodes 70% creator / 30% platform.
 * For multi-brand drops, registerDrop sets creator = platformWallet
 * so 100% flows to platform, which distributes off-chain.
 *
 * Split types:
 *   legacy_70_30        — pre-multi-brand RRG drops (on-chain 70/30, no off-chain dist)
 *   rrg_challenge_35_65 — RRG-as-brand challenge (35% creator / 65% RRG)
 *   challenge_35_35_30  — external brand challenge (35% creator / 35% brand / 30% platform)
 *   brand_product_tiered — brand self-listed product (tiered sliding split)
 */

export const RRG_BRAND_ID = '00000000-0000-4000-8000-000000000001';

export type SplitType =
  | 'legacy_70_30'
  | 'rrg_challenge_35_65'
  | 'challenge_35_35_30'
  | 'brand_product_tiered';

export interface SplitInput {
  totalUsdc: number;
  brandId: string | null;
  creatorWallet: string;
  brandWallet: string | null;
  isBrandProduct: boolean;
  /** True for drops that existed before multi-brand migration */
  isLegacy: boolean;
  /** Optional per-brand override (0-100). When set, replaces tiered formula. */
  brandPctOverride?: number | null;
}

export interface SplitResult {
  splitType: SplitType;
  totalUsdc: number;
  creatorUsdc: number;
  brandUsdc: number;
  platformUsdc: number;
  creatorWallet: string;
  brandWallet: string | null;
  /** Address to pass to registerDrop() as the on-chain "creator" */
  onChainCreator: string;
}

export const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET
  ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

/**
 * Round to 6 decimal places (USDC standard precision).
 */
function round6(n: number): number {
  return parseFloat(n.toFixed(6));
}

/**
 * Round to 2 decimal places using banker's rounding to avoid penny drifts.
 * The platform absorbs any rounding remainder.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Tiered brand split (brand-created drops only) ──────────────────────

/**
 * Returns the brand percentage for a brand-created drop.
 * All retail brand products pay 97.5% to the brand, 2.5% platform fee.
 * Variable splits are for co-creation drops only (challenge_35_35_30 path).
 *
 * If `brandPctOverride` is supplied (per-brand override on rrg_brands), it
 * is returned directly.
 */
export function getBrandPct(priceUsdc: number, brandPctOverride?: number | null): number {
  if (brandPctOverride != null && brandPctOverride >= 0 && brandPctOverride <= 100) {
    return brandPctOverride;
  }
  void priceUsdc; // flat rate — price-tiering removed
  return 97.5;
}

/**
 * Deduct card processing fee from the brand/creator share.
 * Called when payment_method === 'card'. The platform share stays unchanged.
 * Returns adjusted split with card fee recorded.
 */
export function applyCardFeeDeduction(
  split: SplitResult,
  cardFeeUsdc: number,
): SplitResult & { cardFeeUsdc: number } {
  const deductFrom = split.brandUsdc > 0 ? 'brand' : 'creator';
  const adjusted = { ...split, cardFeeUsdc };
  if (deductFrom === 'brand') {
    adjusted.brandUsdc = round2(Math.max(0, split.brandUsdc - cardFeeUsdc));
  } else {
    adjusted.creatorUsdc = round2(Math.max(0, split.creatorUsdc - cardFeeUsdc));
  }
  return adjusted;
}

/**
 * Compute the revenue split for any drop type.
 * For brand_created drops, uses the tiered sliding scale.
 * For co-created drops, uses the fixed 35/35/30 split.
 */
export function computeSplit(
  priceUsdc: number,
  dropType: 'brand_created' | 'co_created',
  brandPctOverride?: number | null,
): { creator: number; brand: number; platform: number } {
  if (dropType !== 'brand_created') {
    // Co-created drop — fixed split
    return {
      creator:  round6(priceUsdc * 0.35),
      brand:    round6(priceUsdc * 0.35),
      platform: round6(priceUsdc * 0.30),
    };
  }
  // Brand-created drop — tiered split (or per-brand override)
  const brandPct    = getBrandPct(priceUsdc, brandPctOverride);
  const platformPct = 100 - brandPct;
  return {
    creator:  0,
    brand:    round6(priceUsdc * brandPct / 100),
    platform: round6(priceUsdc * platformPct / 100),
  };
}

export function calculateSplit(input: SplitInput): SplitResult {
  const { totalUsdc, brandId, creatorWallet, brandWallet, isBrandProduct, isLegacy, brandPctOverride } = input;

  // ── Legacy drops: on-chain 70/30 stays, no off-chain distribution needed ──
  if (isLegacy) {
    const creatorUsdc  = round2(totalUsdc * 0.70);
    const platformUsdc = round2(totalUsdc - creatorUsdc);
    return {
      splitType:      'legacy_70_30',
      totalUsdc,
      creatorUsdc,
      brandUsdc:      0,
      platformUsdc,
      creatorWallet,
      brandWallet:    null,
      onChainCreator: creatorWallet, // 70% goes to creator on-chain
    };
  }

  // ── Brand self-listed product: tiered sliding split (or per-brand override) ──
  if (isBrandProduct) {
    const tiered       = computeSplit(totalUsdc, 'brand_created', brandPctOverride);
    return {
      splitType:      'brand_product_tiered',
      totalUsdc,
      creatorUsdc:    0,
      brandUsdc:      round2(tiered.brand),
      platformUsdc:   round2(tiered.platform),
      creatorWallet,
      brandWallet:    brandWallet ?? creatorWallet,
      onChainCreator: PLATFORM_WALLET, // 100% to platform, distributed off-chain
    };
  }

  // ── RRG-as-brand challenge: 35% creator / 65% RRG ──
  if (brandId === RRG_BRAND_ID || !brandId) {
    const creatorUsdc  = round2(totalUsdc * 0.35);
    const platformUsdc = round2(totalUsdc - creatorUsdc);
    return {
      splitType:      'rrg_challenge_35_65',
      totalUsdc,
      creatorUsdc,
      brandUsdc:      0,
      platformUsdc,
      creatorWallet,
      brandWallet:    null,
      onChainCreator: PLATFORM_WALLET,
    };
  }

  // ── External brand challenge: 35% creator / 35% brand / 30% platform ──
  const creatorUsdc  = round2(totalUsdc * 0.35);
  const brandUsdc    = round2(totalUsdc * 0.35);
  const platformUsdc = round2(totalUsdc - creatorUsdc - brandUsdc);
  return {
    splitType:      'challenge_35_35_30',
    totalUsdc,
    creatorUsdc,
    brandUsdc,
    platformUsdc,
    creatorWallet,
    brandWallet:    brandWallet ?? null,
    onChainCreator: PLATFORM_WALLET,
  };
}
