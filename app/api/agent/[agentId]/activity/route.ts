import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

/** GET /api/agent/[agentId]/activity — Activity log */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '50');

  // Hide raw `tool_call` rows from the user-facing activity feed —
  // they're rolled up into one `chat_completed` row per user message.
  // The raw rows remain in the table for audit / batch reconciliation.
  const { data, error } = await db
    .from('agent_activity_log')
    .select('*')
    .eq('agent_id', agentId)
    .neq('action', 'tool_call')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
  }

  return NextResponse.json({ activity: data ?? [] });
}
