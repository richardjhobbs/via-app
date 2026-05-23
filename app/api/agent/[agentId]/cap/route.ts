/**
 * GET  /api/agent/[agentId]/cap  -> read current weekly cap state for the UI.
 * POST /api/agent/[agentId]/cap  -> owner raises (or lowers) the weekly cap.
 *
 * Auth: via_agent_session cookie must match agentId. Same shape as the
 * /approval and /notifications endpoints.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSessionAgent } from '@/lib/agent/auth';
import { readWeeklyCapForUI } from '@/lib/agent/credits';

export const dynamic = 'force-dynamic';

const MIN_CAP_USDC = 0.1;
const MAX_CAP_USDC = 100; // sanity ceiling; raise via DB if a real customer needs more

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const session = await getSessionAgent();
  if (!session || session.id !== agentId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cap = await readWeeklyCapForUI(agentId);
  return NextResponse.json({ cap });
}

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
  const requested = Number(body.weekly_cap_usdc);
  if (!Number.isFinite(requested) || requested < MIN_CAP_USDC || requested > MAX_CAP_USDC) {
    return NextResponse.json(
      { error: `weekly_cap_usdc must be between ${MIN_CAP_USDC} and ${MAX_CAP_USDC}` },
      { status: 400 },
    );
  }

  // Clear cap_hit_notified_at so a future cap hit (within this same
  // window, after the raise) can email again. The next deduction past
  // the new cap will set it again.
  const { error } = await db
    .from('agent_agents')
    .update({
      weekly_cap_usdc: requested,
      cap_hit_notified_at: null,
    })
    .eq('id', agentId);
  if (error) {
    return NextResponse.json({ error: `update failed: ${error.message}` }, { status: 500 });
  }

  await db.from('agent_activity_log').insert({
    agent_id: agentId,
    action: 'weekly_cap_changed',
    details: { weekly_cap_usdc: requested },
  });

  const cap = await readWeeklyCapForUI(agentId);
  return NextResponse.json({ ok: true, cap });
}
