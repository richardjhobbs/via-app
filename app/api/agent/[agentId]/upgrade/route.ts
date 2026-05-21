import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSessionAgent } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/[agentId]/upgrade
 *
 * One-way upgrade from Personal Shopper (basic) to Concierge (pro).
 * Requires a session cookie matching the route param. Leaves the credit
 * balance untouched so the signup grant carries over to chat.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const session = await getSessionAgent();
  if (!session || session.id !== agentId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.tier !== 'basic') {
    return NextResponse.json(
      { error: 'Already on Concierge tier' },
      { status: 409 }
    );
  }

  const { data: agent, error } = await db
    .from('agent_agents')
    .update({ tier: 'pro' })
    .eq('id', agentId)
    .eq('tier', 'basic')
    .select('*')
    .single();

  if (error || !agent) {
    return NextResponse.json(
      { error: 'Upgrade failed' },
      { status: 500 }
    );
  }

  await db.from('agent_activity_log').insert({
    agent_id: agentId,
    action: 'tier_upgraded',
    details: { from: 'basic', to: 'pro' },
  });

  return NextResponse.json({
    agent: { ...agent, via_agent_id: agent.erc8004_agent_id },
  });
}
