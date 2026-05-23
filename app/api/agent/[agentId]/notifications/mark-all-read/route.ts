import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/[agentId]/notifications/mark-all-read
 *
 * Marks every unread notification for this agent as read.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const now = new Date().toISOString();

  const { error } = await db
    .from('agent_notifications')
    .update({ read_at: now })
    .eq('agent_id', agentId)
    .is('read_at', null);

  if (error) {
    return NextResponse.json({ error: 'Failed to mark all read' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
