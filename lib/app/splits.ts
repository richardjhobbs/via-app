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

export type SplitType = 'seller_product_tiered' | 'room_cocreation';

export interface SplitInput {
  totalUsdc: number;
  sellerWallet: string;
  /** Optional per-seller override (0-100). When set, replaces the default 97.5. */
  sellerPctOverride?: number | null;
}

/** One paid leg of a settled sale: a wallet, its USDC share, and its role. */
export interface SplitRecipient {
  wallet: string;
  usdc:   number;
  role:   string;
}

export interface SplitResult {
  splitType: SplitType;
  totalUsdc: number;
  sellerUsdc: number;
  platformUsdc: number;
  sellerWallet: string;
  /**
   * When present, the seller share is paid to THESE wallets (a room co-creation
   * split), summing exactly to sellerUsdc. When absent, the single sellerWallet
   * is paid. auto-payout branches on this.
   */
  recipients?: SplitRecipient[];
  /** Address to pass to registerDrop() as the on-chain "creator" */
  onChainCreator: string;
}

/** A locked co-creation participant: their payout wallet and share of the seller take. */
export interface CoCreatorShare {
  wallet: string;
  /** Percentage of the SELLER take (after platform 2.5%). Shares sum to 100. */
  pct:    number;
  role?:  string;
}

export const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET
  ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

const DEFAULT_SELLER_PCT = 97.5;

// USDC has 6 decimals, so the split MUST be computed at 6dp. Rounding to 2dp
// (whole cents) silently zeroed the platform's 2.5% on sub-0.20 USDC sales
// (e.g. a 0.05 item: 0.04875 rounded up to 0.05, 0.00125 down to 0.00).
function round6(n: number): number {
  return parseFloat(n.toFixed(6));
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
  // Seller share at 6dp; platform takes the exact remainder so the two always
  // sum to the total with no rounding dust and no lost fee.
  const sellerUsdc   = round6(totalUsdc * sellerPct / 100);
  const platformUsdc = round6(totalUsdc - sellerUsdc);
  return {
    splitType:      'seller_product_tiered',
    totalUsdc,
    sellerUsdc,
    platformUsdc,
    sellerWallet,
    onChainCreator: PLATFORM_WALLET,
  };
}

/**
 * A room co-creation split: the platform still takes the exact 2.5% (or the
 * store's override), and the seller take is divided between the locked
 * co-creators by their agreed percentages. Percentages are treated as shares
 * of the seller take and normalised, so they need only be positive and roughly
 * proportional; the last recipient absorbs the rounding remainder so the legs
 * sum EXACTLY to sellerUsdc (no dust left in, and none over-paid out).
 *
 * onChainCreator stays PLATFORM_WALLET so the on-chain invariant is untouched;
 * the seller share is paid to the recipient wallets off-chain by auto-payout.
 */
export function calculateCoCreationSplit(input: {
  totalUsdc: number;
  cocreators: CoCreatorShare[];
  sellerPctOverride?: number | null;
}): SplitResult {
  const { totalUsdc, cocreators, sellerPctOverride } = input;
  if (!cocreators.length) throw new Error('co-creation split needs at least one recipient');
  const sellerPct = getSellerPct(sellerPctOverride);
  const sellerUsdc   = round6(totalUsdc * sellerPct / 100);
  const platformUsdc = round6(totalUsdc - sellerUsdc);

  const pctTotal = cocreators.reduce((s, c) => s + c.pct, 0);
  if (pctTotal <= 0) throw new Error('co-creation split percentages must be positive');

  const recipients: SplitRecipient[] = [];
  let allocated = 0;
  cocreators.forEach((c, i) => {
    const last = i === cocreators.length - 1;
    // Last recipient takes the exact remainder so the legs sum to sellerUsdc.
    const usdc = last ? round6(sellerUsdc - allocated) : round6(sellerUsdc * c.pct / pctTotal);
    allocated = round6(allocated + usdc);
    recipients.push({ wallet: c.wallet, usdc, role: c.role ?? 'co-creator' });
  });

  return {
    splitType:      'room_cocreation',
    totalUsdc,
    sellerUsdc,
    platformUsdc,
    sellerWallet:   recipients[0].wallet,  // nominal; recipients[] is authoritative
    recipients,
    onChainCreator: PLATFORM_WALLET,
  };
}
