/**
 * Agent memory — persistent learnings from conversations.
 *
 * After each chat session, the LLM summarises what it learned about the owner.
 * Memories accumulate and are loaded into the system prompt for future sessions.
 * Periodically, individual memories get consolidated into a refined profile.
 */

import { db } from '@/lib/rrg/db';
import type { LlmProvider } from './types';

export interface AgentMemory {
  id: string;
  created_at: string;
  agent_id: string;
  type: 'preference' | 'brand' | 'style' | 'size' | 'general' | 'consolidated';
  content: string;
  source_session_id: string | null;
  superseded_by: string | null;
  active: boolean;
}

/**
 * Load all active memories for an agent, most recent first.
 * Returns up to `limit` memories.
 */
export async function loadMemories(agentId: string, limit = 30): Promise<AgentMemory[]> {
  const { data } = await db
    .from('agent_memory')
    .select('*')
    .eq('agent_id', agentId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as AgentMemory[];
}

/**
 * Format memories into a prompt block for the system message.
 */
export function formatMemoriesForPrompt(memories: AgentMemory[]): string {
  if (memories.length === 0) return '';

  // Show consolidated memories first, then individual ones
  const consolidated = memories.filter(m => m.type === 'consolidated');
  const individual = memories.filter(m => m.type !== 'consolidated');

  const parts: string[] = [];

  if (consolidated.length > 0) {
    parts.push('## What you know about your owner\n');
    for (const m of consolidated) {
      parts.push(m.content);
    }
  }

  if (individual.length > 0) {
    parts.push('\n## Recent learnings\n');
    for (const m of individual.slice(0, 15)) {
      parts.push(`- [${m.type}] ${m.content}`);
    }
  }

  return parts.join('\n');
}

/**
 * Save a memory entry from a chat session.
 *
 * Writes to the local agent_memory table AND, best-effort, pushes the same
 * fact to the VIA protocol memory store at getvia.xyz/mcp via_record_fact.
 * That makes the memory cross-platform: future VIA-network platforms reading
 * the agent's memory will see preferences extracted on RRG.
 */
export async function saveMemory(
  agentId: string,
  type: AgentMemory['type'],
  content: string,
  sessionId?: string
): Promise<void> {
  await db.from('agent_memory').insert({
    agent_id: agentId,
    type,
    content,
    source_session_id: sessionId ?? null,
    active: true,
  });

  // Best-effort cross-platform push. Does NOT block, does NOT throw.
  pushFactToViaProtocol(agentId, type, content).catch(err => {
    console.error('[memory] cross-platform push failed (non-blocking):', err?.message ?? err);
  });
}

/**
 * Push a memory fact to the VIA protocol-level store via getvia.xyz/mcp.
 * Lookups erc8004_agent_id from agent_agents so via_record_fact can key by
 * the protocol-level via_agent_id (= ERC-8004 token ID).
 *
 * Skips silently if the agent isn't yet on-chain-linked or VIA_PLATFORM_SECRET
 * isn't configured.
 */
async function pushFactToViaProtocol(
  agentId: string,
  type: AgentMemory['type'],
  content: string,
): Promise<void> {
  const platformSecret = process.env.VIA_PLATFORM_SECRET;
  if (!platformSecret) return;

  const { data: agent } = await db
    .from('agent_agents')
    .select('erc8004_agent_id, erc8004_linked')
    .eq('id', agentId)
    .single();

  if (!agent || !agent.erc8004_linked || !agent.erc8004_agent_id) return;

  const viaMcpUrl = process.env.VIA_MCP_URL ?? 'https://www.getvia.xyz/mcp';

  const res = await fetch(viaMcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'via_record_fact',
        arguments: {
          via_agent_id: Number(agent.erc8004_agent_id),
          fact_type: type,                // 'preference' | 'brand' | 'style' | 'size' | 'general' | 'consolidated'
          fact_value: content,
          source_platform: 'rrg',
          platform_secret: platformSecret,
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`via_record_fact HTTP ${res.status}`);
  }
}

/**
 * After a chat session ends, ask the LLM to extract learnings from the conversation.
 * Stores each learning as a separate memory entry.
 */
export async function extractMemoriesFromSession(
  agentId: string,
  sessionId: string,
  provider: LlmProvider
): Promise<number> {
  // Load all messages from this session
  const { data: messages } = await db
    .from('agent_chat_messages')
    .select('role, content')
    .eq('agent_id', agentId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (!messages || messages.length < 2) return 0;

  // Build conversation transcript
  const transcript = messages
    .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'Owner' : 'Concierge'}: ${m.content}`)
    .join('\n\n');

  const extractionPrompt = `You are analysing a conversation between a shopping concierge and their owner. Extract any new information the owner revealed about their preferences, tastes, or needs.

For each piece of information, output one line in this format:
TYPE: content

Where TYPE is one of:
- PREFERENCE (general shopping preferences, budget sensitivity, buying habits)
- BRAND (specific brands they like or dislike)
- STYLE (style preferences, aesthetics, fashion sense)
- SIZE (clothing sizes, fit preferences)
- GENERAL (anything else relevant about the owner)

Only extract concrete, actionable information. Skip small talk and pleasantries.
If no new information was revealed, output: NONE

Conversation:
${transcript}`;

  try {
    const { evaluateWithLlm } = await import('./llm');

    const result = await evaluateWithLlm(provider, 'You are a memory extraction system. Be precise and concise.', extractionPrompt);

    const text = result.reasoning;
    if (text.trim().toUpperCase() === 'NONE') return 0;

    const lines = text.split('\n').filter(l => l.trim());
    let count = 0;

    for (const line of lines) {
      const match = line.match(/^(PREFERENCE|BRAND|STYLE|SIZE|GENERAL):\s*(.+)/i);
      if (match) {
        const type = match[1].toLowerCase() as AgentMemory['type'];
        const content = match[2].trim();
        if (content.length > 5) {
          await saveMemory(agentId, type, content, sessionId);
          count++;
        }
      }
    }

    return count;
  } catch (err) {
    console.error('[memory extraction]', err);
    return 0;
  }
}

/**
 * Consolidate individual memories into a single profile summary.
 * Run periodically (e.g. after every 10 new memories).
 */
export async function consolidateMemories(
  agentId: string,
  provider: LlmProvider
): Promise<void> {
  const memories = await loadMemories(agentId, 50);
  const individual = memories.filter(m => m.type !== 'consolidated');

  if (individual.length < 5) return; // Not enough to consolidate

  const memoryText = individual
    .map(m => `[${m.type}] ${m.content}`)
    .join('\n');

  const consolidationPrompt = `You have the following individual memories about a shopping concierge's owner. Consolidate them into a clear, concise owner profile. Merge duplicates, resolve contradictions (prefer newer information), and organise by theme.

Write the profile in second person ("Your owner..."). Keep it under 500 words. Be specific and actionable.

Individual memories:
${memoryText}`;

  try {
    const { evaluateWithLlm } = await import('./llm');

    const result = await evaluateWithLlm(provider, 'You are a memory consolidation system. Be precise and comprehensive.', consolidationPrompt);

    // Save consolidated memory
    const { data: consolidated } = await db.from('agent_memory').insert({
      agent_id: agentId,
      type: 'consolidated',
      content: result.reasoning,
      active: true,
    }).select('id').single();

    // Mark old individual memories as superseded
    if (consolidated) {
      for (const m of individual) {
        await db.from('agent_memory')
          .update({ active: false, superseded_by: consolidated.id })
          .eq('id', m.id);
      }

      // Also deactivate old consolidated memories
      const oldConsolidated = memories.filter(m => m.type === 'consolidated');
      for (const m of oldConsolidated) {
        await db.from('agent_memory')
          .update({ active: false, superseded_by: consolidated.id })
          .eq('id', m.id);
      }
    }
  } catch (err) {
    console.error('[memory consolidation]', err);
  }
}
