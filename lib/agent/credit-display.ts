/**
 * Credit display helpers (UI-only conversion).
 *
 * The DB stores credit_balance_usdc in actual USD/USDC for accounting honesty.
 * The UI shows abstract "credits" at 1 USD = 1000 credits, matching the
 * conventions of OpenAI / Cursor / Replit credit-style billing.
 *
 * The user's on-chain USDC wallet balance is NOT converted: that stays in
 * dollars everywhere because it's a real on-chain asset, not a chat meter.
 */

export const CREDITS_PER_USD = 1000;
export const LOW_BALANCE_USD_THRESHOLD = 0.2;

/** Convert a USD amount to whole credits, rounded to nearest. */
export function usdToCredits(usd: number): number {
  return Math.round(usd * CREDITS_PER_USD);
}

/** Format a USD balance as "1,320 credits". */
export function formatCredits(usd: number): string {
  const n = usdToCredits(usd);
  return `${n.toLocaleString()} credit${n === 1 ? '' : 's'}`;
}

/** Format a USD per-chat cost as "1 credit" (rounds up so 1/10th of a cent shows as 1). */
export function formatChatCost(usd: number): string {
  const n = Math.max(1, Math.ceil(usd * CREDITS_PER_USD));
  return `${n.toLocaleString()} credit${n === 1 ? '' : 's'}`;
}

/** Format a USD low/high range as "1 to 50 credits". */
export function formatCreditRange(usdLow: number, usdHigh: number): string {
  const lo = Math.max(1, Math.ceil(usdLow * CREDITS_PER_USD));
  const hi = Math.max(lo, Math.ceil(usdHigh * CREDITS_PER_USD));
  return `${lo.toLocaleString()} to ${hi.toLocaleString()} credits`;
}
