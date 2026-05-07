import { NextRequest, NextResponse } from 'next/server';
import { loadMemories } from '@/lib/agent/memory';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/[agentId]/memory
 *
 * Returns active memory rows for the agent. The dashboard's "What I know
 * about you" panel uses this to surface what the concierge has learned —
 * both seeded at signup (source_session_id = NULL) and chat-extracted.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const memories = await loadMemories(agentId, 100);
  return NextResponse.json({ memories });
}
