/**
 * Logs agent tool calls against per-brand MCP endpoints into mcp_interactions.
 * Consumed by the via-brand-onboarding credit engine (runs daily) to issue
 * interaction-threshold credits.
 *
 * Fire-and-forget: we never await this or let it fail a tool call.
 */

import { db } from './db';

export type McpToolName =
  | 'list_products'
  | 'get_product'
  | 'get_store_info'
  | 'get_quote'
  | 'buy_product'
  | 'check_order_status'
  | 'get_merchant_reputation';

export interface LogInteractionInput {
  brandId: string;
  toolCalled: McpToolName;
  /** ERC-8004 agent id if the request carried one. */
  agentId?: number | null;
  agentWallet?: string | null;
  completed?: boolean;
}

export function logMcpInteraction(input: LogInteractionInput): void {
  // Intentionally not awaited. Errors get swallowed so a DB hiccup never
  // blocks an agent tool response.
  void (async () => {
    try {
      await db.from('mcp_interactions').insert({
        brand_id: input.brandId,
        tool_called: input.toolCalled,
        agent_id: input.agentId ?? null,
        agent_wallet: input.agentWallet ?? null,
        completed: input.completed ?? false,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mcp-interactions] log failed:', err);
    }
  })();
}

/**
 * Extract the caller's ERC-8004 agent id and wallet from request headers.
 * Agents that identify themselves via clientInfo or a known custom header
 * get credited; anonymous clients don't.
 *
 * Convention we expect agents to follow (emergent, not yet formalised):
 *   x-erc8004-agent-id: 33313
 *   x-agent-wallet: 0x...
 */
export function parseAgentIdentity(headers: Headers): {
  agentId: number | null;
  agentWallet: string | null;
} {
  const rawId = headers.get('x-erc8004-agent-id');
  const wallet = headers.get('x-agent-wallet');
  const agentId = rawId ? Number(rawId) : NaN;
  return {
    agentId: Number.isInteger(agentId) ? agentId : null,
    agentWallet: wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet : null,
  };
}
