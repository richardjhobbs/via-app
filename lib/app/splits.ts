/**
 * Revenue split calculator for via-app.
 *
 * Every via-app sale is a seller-listed product (or service) — there is
 * no co-creation surface, so only one split type exists:
 *   seller_product_tiered — 97.5% to the seller, 2.5% to the platform.
 *
 * The on-chain VIA Network contract hardcodes a 70/30 split between the
 * registered drop creator and the platform wallet. To make the 97.5/2.5
 * payout work, registerDrop is always called with creator = PLATFORM_WALLET
 * so 100% of buyer USDC lands in the platform wallet on mint. The 97.5%
 * seller share is then sent off-chain (USDC ERC-20 transfer) by
 * auto-payout.ts. This is the same indirection RRG used; do not change it
 * without also rewriting auto-payout's Guardrail A.
 *
 * A per-seller `sellerPctOverride` on app_sellers can deviate from 97.5
 * if commercial terms require it (e.g. 95/5 for a high-touch onboard).
 */

export type SplitType = 'seller_product_tiered';

export interface SplitInput {
  totalUsdc: number;
  sellerWallet: string;
  /** Optional per-seller override (0-100). When set, replaces the default 97.5. */
  sellerPctOverride?: number | null;
}

export interface SplitResult {
  splitType: SplitType;
  totalUsdc: number;
  sellerUsdc: number;
  platformUsdc: number;
  sellerWallet: string;
  /** Address to pass to registerDrop() as the on-chain "creator" */
  onChainCreator: string;
}

export const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET
  ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

const DEFAULT_SELLER_PCT = 97.5;

function round6(n: number): number {
  return parseFloat(n.toFixed(6));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function getSellerPct(sellerPctOverride?: number | null): number {
  if (sellerPctOverride != null && sellerPctOverride >= 0 && sellerPctOverride <= 100) {
    return sellerPctOverride;
  }
  return DEFAULT_SELLER_PCT;
}

export function calculateSplit(input: SplitInput): SplitResult {
  const { totalUsdc, sellerWallet, sellerPctOverride } = input;
  const sellerPct = getSellerPct(sellerPctOverride);
  const platformPct = 100 - sellerPct;
  return {
    splitType:      'seller_product_tiered',
    totalUsdc,
    sellerUsdc:     round2(round6(totalUsdc * sellerPct / 100)),
    platformUsdc:   round2(round6(totalUsdc * platformPct / 100)),
    sellerWallet,
    onChainCreator: PLATFORM_WALLET,
  };
}
