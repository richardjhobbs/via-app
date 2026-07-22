/**
 * Claim a retired RRG agent's history onto a newly registered VIA buyer.
 *
 * Background: RRG buyer agents were retired so their owners could re-register
 * on VIA with a portable wallet and a fresh identity. Their memory, persona and
 * chat were snapshotted into app_agent_memory_claims first, because those rows
 * cascade-delete with the RRG agent. This module reconnects a snapshot to the
 * new buyer when its owner signs up again with the SAME email.
 *
 * Safety:
 *  - Only UNCLAIMED snapshots are taken, and each is stamped claimed_at +
 *    claimed_buyer_id, so a snapshot can never be applied twice.
 *  - Memories go through the same mapping + idempotent upsert the RRG importer
 *    uses (keyed by external_source/external_id), so re-running is harmless.
 *  - An owner may have held several RRG agents on one email; every matching
 *    snapshot is claimed onto the new buyer.
 *  - Never throws into the caller: a failed claim must not fail a registration.
 */
import { db } from './db';
import { mapRrgMemory, personaMemories, upsertMemories } from './rrg-concierge-import';

interface ClaimRow {
  id: string;
  source_agent_id: string;
  agent_name: string | null;
  persona: Record<string, unknown> | null;
  memories: Array<{ id: string; type: string; content: string }> | null;
  chat_messages: Array<{ role: string; content: string; created_at?: string }> | null;
}

export interface ClaimResult {
  claims: number;
  memoriesInserted: number;
  memoriesUpdated: number;
  messagesImported: number;
}

/**
 * Apply every unclaimed snapshot for `email` to `buyerId`.
 * Returns what was carried over; zeroes if there was nothing to claim.
 */
export async function claimAgentMemories(buyerId: string, email: string): Promise<ClaimResult> {
  const result: ClaimResult = { claims: 0, memoriesInserted: 0, memoriesUpdated: 0, messagesImported: 0 };
  const addr = (email ?? '').trim().toLowerCase();
  if (!buyerId || !addr) return result;

  const { data, error } = await db
    .from('app_agent_memory_claims')
    .select('id, source_agent_id, agent_name, persona, memories, chat_messages')
    .ilike('email', addr)
    .is('claimed_at', null);
  if (error) {
    console.error('[memory-claims] lookup failed:', error.message);
    return result;
  }
  const claims = (data ?? []) as unknown as ClaimRow[];
  if (claims.length === 0) return result;

  for (const c of claims) {
    try {
      // Persona + memories, mapped exactly as the RRG importer maps them.
      const mapped = [
        ...personaMemories((c.persona ?? {}) as unknown as Parameters<typeof personaMemories>[0]),
        ...(c.memories ?? [])
          .map((m) => mapRrgMemory(m as unknown as Parameters<typeof mapRrgMemory>[0]))
          .filter((m): m is NonNullable<typeof m> => m !== null),
      ];
      if (mapped.length > 0) {
        const counts = await upsertMemories(buyerId, mapped);
        result.memoriesInserted += counts.inserted;
        result.memoriesUpdated += counts.updated;
      }

      // Past conversation, kept as one thread so the owner can still read it.
      const chat = (c.chat_messages ?? []).filter((m) => typeof m?.content === 'string' && m.content.trim());
      if (chat.length > 0) {
        const { data: conv } = await db
          .from('app_buyer_conversations')
          .insert({ buyer_id: buyerId, source: 'owner_chat', counterparty: c.agent_name ?? 'rrg concierge' })
          .select('id')
          .single();
        if (conv) {
          const rows = chat.map((m) => ({
            conversation_id: (conv as { id: string }).id,
            role: m.role === 'assistant' || m.role === 'user' || m.role === 'system' ? m.role : 'assistant',
            content: String(m.content).slice(0, 20000),
            ...(m.created_at ? { created_at: m.created_at } : {}),
          }));
          const { error: msgErr } = await db.from('app_buyer_messages').insert(rows);
          if (!msgErr) result.messagesImported += rows.length;
        }
      }

      await db
        .from('app_agent_memory_claims')
        .update({ claimed_at: new Date().toISOString(), claimed_buyer_id: buyerId })
        .eq('id', c.id)
        .is('claimed_at', null);
      result.claims++;
    } catch (err) {
      console.error(`[memory-claims] claim ${c.id} failed:`, err);
    }
  }

  return result;
}
