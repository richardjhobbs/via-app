/**
 * Buying Agent credits , USD-denominated balance for the agent's DeepSeek
 * usage (training chat + negotiate). Mirrors RRG's lib/agent/credits.ts but
 * scoped to app_buyers and DeepSeek-only (no weekly cap: the buyer agent is
 * owner-driven, not autonomous-burning).
 *
 * Display: 1 USD = 1,000 credits. The DB column stays credit_balance_usdc.
 * Pricing carries the same 25% platform margin RRG applies.
 */

import { db } from './db';

// ── Pricing ──────────────────────────────────────────────────────────
const PLATFORM_MARGIN = 1.25;                 // 25% markup on LLM cost
const BASE_COST_PER_TOKEN_DEEPSEEK = 0.000001; // ~$1 / 1M tokens
const COST_PER_TOKEN_DEEPSEEK = BASE_COST_PER_TOKEN_DEEPSEEK * PLATFORM_MARGIN;

/** Approx post-margin cost of one chat eval, used for the pre-call balance gate. */
export const LLM_COST_PER_EVAL_DEEPSEEK = 0.00125;

/** Display conversion. 1 USD shown as 1,000 credits. */
export const CREDITS_PER_USD = 1000;
/** Welcome / CAC grant handed out at signup. */
export const WELCOME_CREDIT_USDC = 1.0;

/** USD balance -> integer credits for UI. */
export function usdToCredits(usd: number): number {
  return Math.round(usd * CREDITS_PER_USD);
}

/** Post-margin USD cost of a token charge. Floored so every call costs something. */
export function costForTokens(tokensUsed: number): number {
  return Math.max(tokensUsed * COST_PER_TOKEN_DEEPSEEK, 0.0001);
}

/** Read the current USD balance. Returns 0 if the buyer is missing. */
export async function getBalance(buyerId: string): Promise<number> {
  const { data } = await db
    .from('app_buyers')
    .select('credit_balance_usdc')
    .eq('id', buyerId)
    .maybeSingle();
  return Number(data?.credit_balance_usdc ?? 0);
}

/** True if the buyer can afford at least one eval. */
export async function hasCredits(buyerId: string): Promise<boolean> {
  const balance = await getBalance(buyerId);
  return balance >= LLM_COST_PER_EVAL_DEEPSEEK;
}

/**
 * Deduct credits for exact DeepSeek token usage (incl. 25% margin). Atomic via
 * RPC; also writes a ledger row. Returns the new balance. `context` tags the
 * ledger line so chat spend is distinguishable from brief-sourcing spend.
 */
export async function deductCredits(buyerId: string, tokensUsed: number, context?: string): Promise<number> {
  const cost = costForTokens(tokensUsed);
  const { data: newBalance, error } = await db.rpc('app_buyer_credits_deduct', {
    p_buyer_id: buyerId,
    p_cost:     cost,
  });
  if (error) throw new Error(`deductCredits failed: ${error.message}`);

  await db.from('app_buyer_credit_transactions').insert({
    buyer_id:      buyerId,
    type:          'deduction',
    amount_usdc:   -cost,
    balance_after: newBalance,
    description:   `deepseek${context ? ` ${context}` : ''} (${tokensUsed} tokens)`,
  });
  return newBalance as number;
}

/**
 * Deduct an already-computed USD cost (atomic via the same RPC + ledger row).
 * Used when the caller has priced the charge itself, e.g. RRG's concierge chat
 * for a migrated buyer sends the exact cost it computed for its own provider so
 * VIA does not re-price it against its DeepSeek rate. `description` tags the
 * ledger line.
 */
export async function deductCreditsUsd(buyerId: string, costUsd: number, description: string): Promise<number> {
  const cost = Math.max(Number(costUsd) || 0, 0);
  const { data: newBalance, error } = await db.rpc('app_buyer_credits_deduct', {
    p_buyer_id: buyerId,
    p_cost:     cost,
  });
  if (error) throw new Error(`deductCreditsUsd failed: ${error.message}`);

  await db.from('app_buyer_credit_transactions').insert({
    buyer_id:      buyerId,
    type:          'deduction',
    amount_usdc:   -cost,
    balance_after: newBalance,
    description,
  });
  return newBalance as number;
}

/**
 * Top up the balance by a USD amount. Atomic via RPC + ledger row. `reference`
 * is the on-chain tx hash for USDC top-ups (null for the signup grant).
 */
export async function topUpCredits(buyerId: string, amountUsd: number, reference?: string, description?: string): Promise<number> {
  const { data: newBalance, error } = await db.rpc('app_buyer_credits_topup', {
    p_buyer_id: buyerId,
    p_amount:   amountUsd,
  });
  if (error) throw new Error(`topUpCredits failed: ${error.message}`);

  await db.from('app_buyer_credit_transactions').insert({
    buyer_id:      buyerId,
    type:          'topup',
    amount_usdc:   amountUsd,
    balance_after: newBalance,
    description:   description ?? 'Credit top-up',
    tx_hash:       reference ?? null,
  });
  return newBalance as number;
}

/**
 * Hand out the one-time welcome grant (1,000 credits). Idempotent-ish: skips if
 * the buyer already has a signup-grant ledger row, so a retried registration
 * never double-grants.
 */
export async function grantWelcomeCredits(buyerId: string): Promise<number> {
  const { data: prior } = await db
    .from('app_buyer_credit_transactions')
    .select('id')
    .eq('buyer_id', buyerId)
    .eq('description', 'Signup grant (1000 credits, welcome)')
    .maybeSingle();
  if (prior) return getBalance(buyerId);

  return topUpCredits(buyerId, WELCOME_CREDIT_USDC, undefined, 'Signup grant (1000 credits, welcome)');
}

const RRG_BASE = (process.env.RRG_BASE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

/**
 * Transfer a migrated buyer's prepaid RRG credit balance into VIA, exactly once.
 *
 * VIA's own ledger is the idempotency guard: a transfer row is tagged
 * `tx_hash = rrg:<rrgAgentId>`. If it exists we never call RRG again. Otherwise
 * we call RRG's atomic drain (which zeroes the RRG balance once) and credit the
 * TOTAL amount it reports migrated. Because the RRG drain reports the migrated
 * total even on a repeat, a prior drain whose VIA credit failed is recovered on
 * the next run without any double-credit (this ledger check blocks that) or
 * double-drain (the RRG side blocks that).
 */
export async function transferRrgCredits(
  buyerId: string,
  rrgAgentId: string,
): Promise<{ transferred: number; alreadyTransferred: boolean }> {
  const marker = `rrg:${rrgAgentId}`;
  const { data: prior } = await db
    .from('app_buyer_credit_transactions')
    .select('id')
    .eq('buyer_id', buyerId)
    .eq('tx_hash', marker)
    .eq('description', 'RRG migration credit transfer')
    .maybeSingle();
  if (prior) return { transferred: 0, alreadyTransferred: true };

  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) { console.warn('[buyer-credits] VIA_PLATFORM_SECRET unset; cannot drain RRG credits'); return { transferred: 0, alreadyTransferred: false }; }

  let migrated = 0;
  try {
    const res = await fetch(`${RRG_BASE}/api/via/credit-drain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-via-platform-secret': secret },
      body: JSON.stringify({ ref: rrgAgentId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.warn(`[buyer-credits] RRG drain HTTP ${res.status} for ${rrgAgentId}`); return { transferred: 0, alreadyTransferred: false }; }
    const j = await res.json() as { migrated_amount?: number };
    migrated = Math.max(Number(j.migrated_amount ?? 0), 0);
  } catch (e) {
    console.warn('[buyer-credits] RRG drain unreachable:', e);
    return { transferred: 0, alreadyTransferred: false };
  }

  if (migrated <= 0) return { transferred: 0, alreadyTransferred: false };
  await topUpCredits(buyerId, migrated, marker, 'RRG migration credit transfer');
  return { transferred: migrated, alreadyTransferred: false };
}

/** Credit transaction history, newest first. */
export async function getCreditHistory(buyerId: string, limit = 50) {
  const { data } = await db
    .from('app_buyer_credit_transactions')
    .select('*')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}
