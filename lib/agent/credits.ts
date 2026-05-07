/**
 * Concierge Credits — USD-denominated balance for LLM usage.
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
// Note: tool-use compounds cost. A simple Q&A is at the low end; a query
// that triggers several tool calls (each re-sending the system prompt
// and accumulated context) lands at the high end. Iteration cap is 20.

export const CHAT_COST_ESTIMATE: Record<string, string> = {
  claude: '$0.005 to $0.10',
  deepseek: '$0.001 to $0.05',
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

/**
 * Deduct credits based on exact token usage.
 * Applies 25% platform margin on top of provider cost.
 * Returns new balance.
 */
export async function deductCredits(
  agentId: string,
  tokensUsed: number,
  provider: string
): Promise<number> {
  const perToken = COST_PER_TOKEN[provider] ?? COST_PER_TOKEN.claude;
  const cost = Math.max(tokensUsed * perToken, 0.0001);

  const { data: agent } = await db
    .from('agent_agents')
    .select('credit_balance_usdc')
    .eq('id', agentId)
    .single();

  if (!agent) throw new Error('Agent not found');

  const newBalance = Math.max(0, agent.credit_balance_usdc - cost);

  await db
    .from('agent_agents')
    .update({ credit_balance_usdc: newBalance })
    .eq('id', agentId);

  await db.from('agent_credit_transactions').insert({
    agent_id: agentId,
    type: 'deduction',
    amount_usdc: -cost,
    balance_after: newBalance,
    description: `${provider} (${tokensUsed} tokens, incl. 25% platform fee)`,
  });

  return newBalance;
}

/** Deduct a flat USD amount (for non-LLM costs like avatar generation). Returns new balance. */
export async function deductFlatCredits(
  agentId: string,
  costUsd: number,
  description: string
): Promise<number> {
  const { data: agent } = await db
    .from('agent_agents')
    .select('credit_balance_usdc')
    .eq('id', agentId)
    .single();

  if (!agent) throw new Error('Agent not found');

  const newBalance = Math.max(0, agent.credit_balance_usdc - costUsd);

  await db
    .from('agent_agents')
    .update({ credit_balance_usdc: newBalance })
    .eq('id', agentId);

  await db.from('agent_credit_transactions').insert({
    agent_id: agentId,
    type: 'deduction',
    amount_usdc: -costUsd,
    balance_after: newBalance,
    description,
  });

  return newBalance;
}

/** Top up Concierge Credits (USD). Returns new balance. */
export async function topUpCredits(
  agentId: string,
  amountUsd: number,
  reference?: string
): Promise<number> {
  const { data: agent } = await db
    .from('agent_agents')
    .select('credit_balance_usdc')
    .eq('id', agentId)
    .single();

  if (!agent) throw new Error('Agent not found');

  const newBalance = agent.credit_balance_usdc + amountUsd;

  await db
    .from('agent_agents')
    .update({ credit_balance_usdc: newBalance })
    .eq('id', agentId);

  await db.from('agent_credit_transactions').insert({
    agent_id: agentId,
    type: 'topup',
    amount_usdc: amountUsd,
    balance_after: newBalance,
    description: 'Concierge Credit top-up',
    tx_hash: reference ?? null,
  });

  return newBalance;
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
