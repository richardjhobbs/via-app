/**
 * Create the linked RRG chat shell for a VIA buyer.
 *
 * VIA owns buyer agents; RRG stays a place the owner can sign in and chat. This
 * asks RRG to upsert a via_buyer_linked agent_agents row carrying the VIA
 * identity + wallet, so the concierge sign-in finds the agent and the RRG chat
 * runtime reads its credits and memory from VIA. The RRG shell's id is written
 * back onto app_buyers.linked_rrg_agent_id, because every VIA bridge endpoint
 * (credits, identity, memory) resolves the buyer by that id, so RRG passing its
 * shell id must resolve to this buyer. Best-effort: a failure never fails a VIA
 * registration/login (it re-attaches on the next sign-in).
 */
import { db } from './db';

const RRG_BASE = (process.env.RRG_BASE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

export async function attachRrgShell(input: {
  buyerId: string;
  email: string;
  name: string;
  handle: string;
  walletAddress: string;
  erc8004AgentId?: string | number | null;
}): Promise<boolean> {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) { console.warn('[rrg-shell] VIA_PLATFORM_SECRET unset; cannot attach RRG chat shell'); return false; }
  try {
    const res = await fetch(`${RRG_BASE}/api/via/attach-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-via-platform-secret': secret },
      body: JSON.stringify({
        email: input.email,
        name: input.name,
        via_handle: input.handle,
        wallet_address: input.walletAddress,
        erc8004_agent_id: input.erc8004AgentId ?? null,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) { console.warn(`[rrg-shell] attach HTTP ${res.status} for handle=${input.handle}`); return false; }
    const j = await res.json() as { agent_id?: string };
    const shellId = j.agent_id;
    if (!shellId) return false;

    // Point this buyer at the shell so RRG's bridge calls (which key on the
    // shell's agent id) resolve back here. Skip if already set to this id.
    const { data: cur } = await db.from('app_buyers').select('linked_rrg_agent_id').eq('id', input.buyerId).maybeSingle();
    if ((cur as { linked_rrg_agent_id?: string } | null)?.linked_rrg_agent_id !== shellId) {
      const { error } = await db.from('app_buyers').update({ linked_rrg_agent_id: shellId }).eq('id', input.buyerId);
      if (error) { console.warn(`[rrg-shell] linked_rrg_agent_id update failed for handle=${input.handle}:`, error.message); return false; }
    }
    return true;
  } catch (e) {
    console.warn('[rrg-shell] attach unreachable:', e);
    return false;
  }
}
