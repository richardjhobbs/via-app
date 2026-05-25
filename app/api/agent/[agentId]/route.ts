import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { parseInstructions } from '@/lib/agent/rules';
import { LLM_PROVIDER_OPTIONS } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

// Single source of truth for which LLM providers a Personal Agent may run
// on. Derived from the same array the wizard / dashboard render, so adding
// Claude back to LLM_PROVIDER_OPTIONS automatically re-enables the PATCH.
const ALLOWED_LLM_PROVIDERS = new Set(
  LLM_PROVIDER_OPTIONS.map((o) => o.value),
);

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

  // Reject any llm_provider not in the active option set. Belt-and-braces
  // alongside the UI: a stale client or scripted PATCH can't silently put
  // an agent back onto a provider whose code path isn't wired (e.g. Claude
  // without tool-use), which would re-introduce the hallucinated-URL bug.
  if ('llm_provider' in updates && !ALLOWED_LLM_PROVIDERS.has(updates.llm_provider as never)) {
    return NextResponse.json(
      { error: `llm_provider '${updates.llm_provider}' is not currently supported` },
      { status: 400 },
    );
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
