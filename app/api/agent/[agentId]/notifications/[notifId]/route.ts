import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/agent/[agentId]/notifications/[notifId]
 *
 * Body: { read: boolean }
 *
 * Toggles read state. Scoped to agent_id so a stray notif_id from another
 * agent does nothing.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; notifId: string }> }
) {
  const { agentId, notifId } = await params;
  const body = await req.json().catch(() => ({}));
  const read = body?.read !== false;

  const { error } = await db
    .from('agent_notifications')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('id', notifId)
    .eq('agent_id', agentId);

  if (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
