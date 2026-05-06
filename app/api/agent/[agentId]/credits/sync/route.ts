import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { topUpCredits } from '@/lib/agent/credits';
import { getUsdcBalance } from '@/lib/agent/contract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/[agentId]/credits/sync
 *
 * Reads the agent's on-chain USDC balance and credits any positive delta
 * since the last sync. The first call establishes the baseline (no credit)
 * so existing on-chain holdings aren't double-counted.
 *
 * Returns the post-sync credit balance. No body required.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const { data: agent } = await db
    .from('agent_agents')
    .select('id, wallet_address, credit_balance_usdc, last_synced_balance_usdc, last_synced_at')
    .eq('id', agentId)
    .single();

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  let onChainBalance: number;
  try {
    onChainBalance = await getUsdcBalance(agent.wallet_address);
  } catch (err) {
    console.error('[credits sync] balance read failed', err);
    return NextResponse.json({ error: 'Failed to read on-chain balance' }, { status: 502 });
  }

  const baseline = Number(agent.last_synced_balance_usdc ?? 0);
  const delta = onChainBalance - baseline;

  // Outbound spend (e.g. drop purchase) → balance dropped. Advance baseline,
  // do not adjust credits (LLM accounting is a separate ledger).
  if (delta <= 0) {
    if (onChainBalance !== baseline) {
      await db
        .from('agent_agents')
        .update({
          last_synced_balance_usdc: onChainBalance,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', agentId);
    }

    return NextResponse.json({
      credited: 0,
      on_chain_balance: onChainBalance,
      credit_balance: Number(agent.credit_balance_usdc),
    });
  }

  // Inbound delta → credit it.
  const newCreditBalance = await topUpCredits(
    agentId,
    delta,
    `sync:${onChainBalance.toFixed(6)}`,
  );

  await db
    .from('agent_agents')
    .update({
      last_synced_balance_usdc: onChainBalance,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', agentId);

  return NextResponse.json({
    credited: delta,
    on_chain_balance: onChainBalance,
    credit_balance: newCreditBalance,
  });
}
