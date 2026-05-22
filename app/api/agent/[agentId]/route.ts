import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { parseInstructions } from '@/lib/agent/rules';

export const dynamic = 'force-dynamic';

/** GET /api/agent/[agentId]: Read agent profile */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const { data: agent, error } = await db
    .from('agent_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  return NextResponse.json({ agent: { ...agent, via_agent_id: agent.erc8004_agent_id } });
}

/** PATCH /api/agent/[agentId]: Update preferences */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const body = await req.json();

  // Only allow updating these fields
  const allowed = [
    'name',
    'style_tags',
    'free_instructions',
    'budget_ceiling_usdc',
    'bid_aggression',
    'llm_provider',
    'tier',
    'persona_bio',
    'persona_voice',
    'persona_comm_style',
    'interest_categories',
    'avatar_path',
    'avatar_source',
    'sex',
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  // Re-parse rules if instructions changed
  if ('free_instructions' in updates) {
    updates.parsed_rules = parseInstructions(updates.free_instructions as string);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: agent, error } = await db
    .from('agent_agents')
    .update(updates)
    .eq('id', agentId)
    .select('*')
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  await db.from('agent_activity_log').insert({
    agent_id: agentId,
    action: 'preferences_updated',
    details: { fields: Object.keys(updates) },
  });

  return NextResponse.json({ agent: { ...agent, via_agent_id: agent.erc8004_agent_id } });
}
