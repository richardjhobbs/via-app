/**
 * GET /api/agent/session/unread-count
 *
 * Returns the unread notification count for the currently-signed-in
 * agent (from the via_agent_session cookie). Powers the dot on the
 * Concierge nav tab.
 *
 * 200 { count: number } when signed in.
 * 200 { count: 0 }     when no session (anonymous users see no badge).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const agentId = cookieStore.get('via_agent_session')?.value;
  if (!agentId) {
    return NextResponse.json({ count: 0 });
  }

  const { count } = await db
    .from('agent_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .is('read_at', null);

  return NextResponse.json({ count: count ?? 0 });
}
