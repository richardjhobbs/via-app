/**
 * Concierge Credits, USD-denominated balance for LLM usage.
 *
 * Credits are consumed per chat message and drop evaluation.
 * When credits run out, the Concierge falls back to Personal Shopper rules.
 *
 * Pricing includes a 25% platform margin on top of LLM provider costs.
 * The DB column is still named credit_balance_usdc for compatibility,
 * but the balance is denominated in USD.
 */

import { db } from '@/lib/rrg/db';

// ── Platform margin ─────────────────────────────────────────────────

const PLATFORM_MARGIN = 1.25; // 25% markup on LLM costs

// ── Provider cost per token (what the LLM charges us) ───────────────

const BASE_COST_PER_TOKEN: Record<string, number> = {
  claude: 0.000005,   // ~$5 per 1M tokens (blended input+output)
  deepseek: 0.000001, // ~$1 per 1M tokens
};

// ── Cost per token charged to user (base + margin) ──────────────────

const COST_PER_TOKEN: Record<string, number> = {
  claude: BASE_COST_PER_TOKEN.claude * PLATFORM_MARGIN,
  deepseek: BASE_COST_PER_TOKEN.deepseek * PLATFORM_MARGIN,
};

// ── Approximate cost per evaluation (for UI display) ────────────────

export const LLM_COST_PER_EVAL: Record<string, number> = {
  claude: 0.00625,   // ~$0.005 base + 25%
  deepseek: 0.00125, // ~$0.001 base + 25%
};

// ── Approximate cost per chat message (for UI display) ──────────────
//
// UI shows credits at 1 USD = 1000 credits (see lib/agent/credit-display.ts).
// USD ranges:
//   claude:   $0.005 to $0.10   (5 to 100 credits)
//   deepseek: $0.001 to $0.05   (1 to 50 credits)
// Tool-use compounds cost: a simple Q&A is at the low end; a query that
// triggers several tool calls (each re-sending the system prompt + context)
// lands at the high end. Iteration cap is 20.

export const CHAT_COST_ESTIMATE: Record<string, string> = {
  claude: '5 to 100 credits',
  deepseek: '1 to 50 credits',
};

/** Check if a Concierge has sufficient credits for an operation. */
export async function hasCredits(agentId: string): Promise<boolean> {
  const { data } = await db
    .from('agent_agents')
    .select('credit_balance_usdc, llm_provider')
    .eq('id', agentId)
    .single();

  if (!data) return false;
  const cost = LLM_COST_PER_EVAL[data.llm_provider] ?? 0.00625;
  return data.credit_balance_usdc >= cost;
}

/** 7-day rolling window length in milliseconds. */
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Default per-agent weekly cap when DB row is null (mirrors column default). */
const DEFAULT_WEEKLY_CAP_USDC = 1.0;

export class WeeklyCapExceededError extends Error {
  constructor(
    public agentId: string,
    public weeklySpent: number,
    public weeklyCap: number,
  ) {
    super(
      `Agent ${agentId} weekly LLM cap reached ($${weeklySpent.toFixed(4)} / $${weeklyCap.toFixed(2)}). ` +
      'Owner must raise the cap before further LLM calls.',
    );
    this.name = 'WeeklyCapExceededError';
  }
}

/**
 * Compute the post-margin USD cost of a token charge. Pure helper, no
 * side effects, used both by deductCredits and by the pre-call cap gate.
 */
export function costForTokens(tokensUsed: number, provider: string): number {
  const perToken = COST_PER_TOKEN[provider] ?? COST_PER_TOKEN.claude;
  return Math.max(tokensUsed * perToken, 0.0001);
}

interface AgentCapRow {
  weekly_cap_usdc: number | string | null;
  weekly_window_start: string | null;
  weekly_spent_usdc: number | string | null;
  cap_hit_notified_at: string | null;
  email: string | null;
  name: string | null;
}

/**
 * Read the cap state for an agent, rolling the window forward if 7+ days
 * have elapsed since weekly_window_start. Returns the effective weekly
 * spend and cap; never persists a rollover until a deduction actually
 * lands (so the pre-call gate is a pure read).
 */
async function readCapState(agentId: string): Promise<{
  weeklyCap: number;
  weeklySpent: number;
  weeklyWindowStart: Date | null;
  windowExpired: boolean;
  email: string | null;
  name: string | null;
  capHitNotifiedAt: Date | null;
}> {
  const { data, error } = await db
    .from('agent_agents')
    .select('weekly_cap_usdc, weekly_window_start, weekly_spent_usdc, cap_hit_notified_at, email, name')
    .eq('id', agentId)
    .single();
  if (error || !data) {
    throw new Error(`readCapState: ${error?.message ?? 'agent not found'}`);
  }
  const row = data as AgentCapRow;
  const weeklyCap = Number(row.weekly_cap_usdc ?? DEFAULT_WEEKLY_CAP_USDC);
  const weeklyWindowStart = row.weekly_window_start ? new Date(row.weekly_window_start) : null;
  const windowExpired =
    !!weeklyWindowStart && Date.now() - weeklyWindowStart.getTime() >= WEEKLY_WINDOW_MS;
  const weeklySpent = windowExpired ? 0 : Number(row.weekly_spent_usdc ?? 0);
  return {
    weeklyCap,
    weeklySpent,
    weeklyWindowStart,
    windowExpired,
    email: row.email,
    name: row.name,
    capHitNotifiedAt: row.cap_hit_notified_at ? new Date(row.cap_hit_notified_at) : null,
  };
}

/**
 * Pre-call gate. Returns true if the agent has cap headroom for at least
 * 1 cent of additional spend; false if the cap has already been reached
 * this window. Callers should reject the LLM call cleanly when false.
 */
export async function hasCapAvailable(agentId: string): Promise<boolean> {
  const state = await readCapState(agentId);
  return state.weeklySpent < state.weeklyCap;
}

/**
 * Deduct credits based on exact token usage.
 * Applies 25% platform margin on top of provider cost.
 * Returns new balance.
 *
 * Also accumulates weekly_spent_usdc and throws WeeklyCapExceededError
 * if the deduction would exceed weekly_cap_usdc. Callers should gate
 * with hasCapAvailable() BEFORE the LLM call to avoid wasting the
 * upstream cost; this is the final safety net.
 *
 * On cap-hit (the first deduction that pushes spend across the cap),
 * the deduction is still recorded (the LLM call already happened and
 * cost real money) but a cap_block row is also written and the
 * cap-hit email is queued by the caller via the returned needsEmail
 * signal.
 */
export async function deductCredits(
  agentId: string,
  tokensUsed: number,
  provider: string
): Promise<number> {
  const cost = costForTokens(tokensUsed, provider);

  // Roll the weekly window forward + accumulate spend in one write.
  // We accept the small race where two concurrent deductCredits within
  // the same window each read the pre-update spend; the cap may be
  // exceeded by at most one in-flight call. Cheap, acceptable, no lock
  // needed for the volumes in play.
  const state = await readCapState(agentId);
  const nowIso = new Date().toISOString();
  const newWindowStart =
    state.weeklyWindowStart === null || state.windowExpired
      ? nowIso
      : state.weeklyWindowStart.toISOString();
  const newWeeklySpent = (state.windowExpired ? 0 : state.weeklySpent) + cost;
  const crossedCap = state.weeklySpent < state.weeklyCap && newWeeklySpent >= state.weeklyCap;

  const { data: newBalance, error } = await db.rpc('agent_credits_deduct', {
    p_agent_id: agentId,
    p_cost: cost,
  });
  if (error) throw new Error(`deductCredits failed: ${error.message}`);

  await db
    .from('agent_agents')
    .update({
      weekly_window_start: newWindowStart,
      weekly_spent_usdc: newWeeklySpent,
      // Only stamp cap_hit_notified_at when we cross the cap in this call;
      // dedupes the email to once per window.
      ...(crossedCap ? { cap_hit_notified_at: nowIso } : {}),
    })
    .eq('id', agentId);

  await db.from('agent_credit_transactions').insert({
    agent_id: agentId,
    type: 'deduction',
    amount_usdc: -cost,
    balance_after: newBalance,
    description: `${provider} (${tokensUsed} tokens, incl. 25% platform fee)`,
  });

  if (crossedCap) {
    // Caller is responsible for the email send (so we don't hard-couple
    // credits.ts to email.ts); they read state via readWeeklyCapForUI.
    // Audit row makes the cap-hit visible in the credit ledger.
    await db.from('agent_credit_transactions').insert({
      agent_id: agentId,
      type: 'cap_block',
      amount_usdc: 0,
      balance_after: newBalance,
      description: `Weekly cap reached at $${newWeeklySpent.toFixed(4)} of $${state.weeklyCap.toFixed(2)}`,
    });
    // Fire the email best-effort. Failure does NOT block the deduction.
    try {
      const { sendWeeklyCapHit } = await import('./email');
      if (state.email && state.name) {
        await sendWeeklyCapHit(state.email, state.name, {
          weeklyCapUsdc: state.weeklyCap,
          weeklySpentUsdc: newWeeklySpent,
        });
      }
    } catch (err) {
      console.error('[deductCredits cap-hit email]', err);
    }
  }

  return newBalance as number;
}

/**
 * Reads the cap state in a shape suitable for the dashboard pill / nav
 * indicator. Caller-side, no mutation. Returns null if the agent has no
 * window yet (no LLM calls this window).
 */
export async function readWeeklyCapForUI(agentId: string): Promise<{
  weeklyCap: number;
  weeklySpent: number;
  windowEndsAt: string;
  capHit: boolean;
} | null> {
  const state = await readCapState(agentId);
  if (!state.weeklyWindowStart) {
    return {
      weeklyCap: state.weeklyCap,
      weeklySpent: 0,
      windowEndsAt: new Date(Date.now() + WEEKLY_WINDOW_MS).toISOString(),
      capHit: false,
    };
  }
  const windowEndsAt = new Date(
    state.weeklyWindowStart.getTime() + WEEKLY_WINDOW_MS,
  ).toISOString();
  return {
    weeklyCap: state.weeklyCap,
    weeklySpent: state.weeklySpent,
    windowEndsAt,
    capHit: state.weeklySpent >= state.weeklyCap,
  };
}

/** Deduct a flat USD amount (for non-LLM costs like avatar generation). Returns new balance. */
export async function deductFlatCredits(
  agentId: string,
  costUsd: number,
  description: string
): Promise<number> {
  const { data: newBalance, error } = await db.rpc('agent_credits_deduct', {
    p_agent_id: agentId,
    p_cost: costUsd,
  });

  if (error) throw new Error(`deductFlatCredits failed: ${error.message}`);

  await db.from('agent_credit_transactions').insert({
    agent_id: agentId,
    type: 'deduction',
    amount_usdc: -costUsd,
    balance_after: newBalance,
    description,
  });

  return newBalance as number;
}

/** Top up Concierge Credits (USD). Returns new balance. */
export async function topUpCredits(
  agentId: string,
  amountUsd: number,
  reference?: string
): Promise<number> {
  const { data: newBalance, error } = await db.rpc('agent_credits_topup', {
    p_agent_id: agentId,
    p_amount: amountUsd,
  });

  if (error) throw new Error(`topUpCredits failed: ${error.message}`);

  await db.from('agent_credit_transactions').insert({
    agent_id: agentId,
    type: 'topup',
    amount_usdc: amountUsd,
    balance_after: newBalance,
    description: 'Concierge Credit top-up',
    tx_hash: reference ?? null,
  });

  return newBalance as number;
}

/** Get credit transaction history for an agent. */
export async function getCreditHistory(agentId: string, limit = 50) {
  const { data } = await db
    .from('agent_credit_transactions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data ?? [];
}
