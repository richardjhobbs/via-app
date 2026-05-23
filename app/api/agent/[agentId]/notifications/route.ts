import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/[agentId]/notifications
 *
 * List the agent's notifications (newest first) and the unread count.
 * Auth model mirrors /activity: the session cookie carries the agent_id
 * the dashboard then queries; we trust that boundary.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '50'), 1), 200);
  const unreadOnly = req.nextUrl.searchParams.get('unread_only') === '1';

  let q = db
    .from('agent_notifications')
    .select('id, created_at, kind, title, body, payload, read_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    q = q.is('read_at', null);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }

  const { count: unreadCount } = await db
    .from('agent_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .is('read_at', null);

  return NextResponse.json({
    notifications: data ?? [],
    unread_count: unreadCount ?? 0,
  });
}
