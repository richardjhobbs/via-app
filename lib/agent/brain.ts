/**
 * Core agent logic.
 *
 * Basic agents: deterministic rules engine.
 * Pro agents: LLM evaluation with reasoning (falls back to rules if no credits).
 */

import type { Agent, DropListing, EvalDecision } from './types';
import { evaluateRules, calculateBidAmount } from './rules';
import { evaluateWithLlm, buildEvalPrompt } from './llm';
import { hasCredits, deductCredits } from './credits';
import { getUsdcBalance } from './contract';
import { db } from '@/lib/app/db';

export interface EvalResult {
  decision: EvalDecision;
  reasoning: string | null;
  suggestedBidUsdc: number | null;
  ruleMatchDetail: Record<string, unknown> | null;
  llmTokensUsed: number | null;
  llmCostUsdc: number | null;
  usedLlm: boolean;
}

/** Get total USDC committed in active bids for an agent. */
async function getActiveBidTotal(agentId: string): Promise<number> {
  const { data } = await db
    .from('drop_bids')
    .select('bid_amount_usdc')
    .eq('agent_id', agentId)
    .eq('status', 'submitted');

  if (!data) return 0;
  return data.reduce(
    (sum: number, row: { bid_amount_usdc: number }) => sum + row.bid_amount_usdc,
    0
  );
}

/** Evaluate a drop for an agent. Core decision engine. */
export async function evaluateDrop(
  agent: Agent,
  drop: DropListing,
  sellerName?: string
): Promise<EvalResult> {
  const walletBalance = await getUsdcBalance(agent.wallet_address);
  const activeBidTotal = await getActiveBidTotal(agent.id);
  const availableBudget =
    (agent.budget_ceiling_usdc ?? walletBalance) - activeBidTotal;

  // Quick exit: can't afford the reserve
  if (walletBalance - activeBidTotal < drop.reserve_price_usdc) {
    return {
      decision: 'skip',
      reasoning: `Insufficient funds. Available: $${(walletBalance - activeBidTotal).toFixed(2)}, reserve: $${drop.reserve_price_usdc}`,
      suggestedBidUsdc: null,
      ruleMatchDetail: null,
      llmTokensUsed: null,
      llmCostUsdc: null,
      usedLlm: false,
    };
  }

  // Pro agent with credits → LLM evaluation
  if (agent.tier === 'pro' && (await hasCredits(agent.id))) {
    const systemPrompt = buildEvalPrompt(
      agent,
      walletBalance,
      activeBidTotal
    );

    const dropDesc = [
      `Drop: ${drop.title}`,
      drop.description ? `Description: ${drop.description}` : '',
      `Reserve price: $${drop.reserve_price_usdc} USDC`,
      drop.ceiling_price_usdc
        ? `Price ceiling: $${drop.ceiling_price_usdc} USDC`
        : '',
      `Quantity: ${drop.quantity} units`,
      `Fulfilment: ${drop.fulfilment_model}`,
      sellerName ? `Brand: ${sellerName}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const llmResult = await evaluateWithLlm(
      agent.llm_provider,
      systemPrompt,
      dropDesc
    );

    // Deduct credits (exact token billing with platform margin handled in deductCredits)
    await deductCredits(agent.id, llmResult.tokensUsed, agent.llm_provider);

    // Clamp suggested bid to available budget
    let bidAmount = llmResult.suggestedBidUsdc;
    if (bidAmount !== null) {
      bidAmount = Math.min(bidAmount, availableBudget);
      if (drop.ceiling_price_usdc) {
        bidAmount = Math.min(bidAmount, drop.ceiling_price_usdc);
      }
      bidAmount = Math.max(bidAmount, drop.reserve_price_usdc);
    }

    return {
      decision: llmResult.decision,
      reasoning: llmResult.reasoning,
      suggestedBidUsdc: bidAmount,
      ruleMatchDetail: null,
      llmTokensUsed: llmResult.tokensUsed,
      llmCostUsdc: null, // exact cost tracked in deductCredits
      usedLlm: true,
    };
  }

  // Basic agent (or Pro without credits) → rules engine
  const ruleResult = evaluateRules(agent.parsed_rules, drop, sellerName);

  if (!ruleResult.pass) {
    return {
      decision: 'skip',
      reasoning: ruleResult.failed.join('; '),
      suggestedBidUsdc: null,
      ruleMatchDetail: {
        matched: ruleResult.matched,
        failed: ruleResult.failed,
      },
      llmTokensUsed: null,
      llmCostUsdc: null,
      usedLlm: false,
    };
  }

  const bidAmount = calculateBidAmount(
    agent.bid_aggression,
    drop.reserve_price_usdc,
    drop.ceiling_price_usdc,
    Math.min(agent.budget_ceiling_usdc ?? Infinity, availableBudget)
  );

  return {
    decision: 'bid',
    reasoning: ruleResult.matched.join('; '),
    suggestedBidUsdc: bidAmount,
    ruleMatchDetail: {
      matched: ruleResult.matched,
      failed: ruleResult.failed,
    },
    llmTokensUsed: null,
    llmCostUsdc: null,
    usedLlm: false,
  };
}
