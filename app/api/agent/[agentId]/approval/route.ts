/**
 * POST /api/agent/[agentId]/approval
 *
 * Record the on-chain USDC.approve transaction the agent wallet has
 * signed in favour of the platform settlement spender. After this row
 * is written, the daily settlement cron will start pulling owed LLM
 * cost from the agent wallet up to the configured weekly cap.
 *
 * Body: { tx_hash: string, spender: string }
 *
 * The signer / Thirdweb flow does the signature in the dashboard.
 * This endpoint only stores the metadata; the actual on-chain
 * allowance is verified at settlement time via getUsdcAllowance.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSessionAgent } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;

  const session = await getSessionAgent();
  if (!session || session.id !== agentId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tx_hash = typeof body.tx_hash === 'string' ? body.tx_hash.trim() : '';
  const spender = typeof body.spender === 'string' ? body.spender.trim().toLowerCase() : '';
  if (!tx_hash || !spender) {
    return NextResponse.json({ error: 'tx_hash and spender required' }, { status: 400 });
  }

  const { error } = await db
    .from('agent_agents')
    .update({
      approval_tx_hash: tx_hash,
      approval_spender: spender,
      approval_at: new Date().toISOString(),
    })
    .eq('id', agentId);

  if (error) {
    return NextResponse.json({ error: `update failed: ${error.message}` }, { status: 500 });
  }

  await db.from('agent_activity_log').insert({
    agent_id: agentId,
    action: 'usdc_approval_granted',
    details: { tx_hash, spender },
    tx_hash,
  });

  return NextResponse.json({ ok: true, tx_hash, spender });
}
