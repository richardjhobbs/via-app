/**
 * Create the linked RRG chat shell for a VIA buyer.
 *
 * VIA owns buyer agents; RRG stays a place the owner can sign in and chat. This
 * asks RRG to upsert a via_buyer_linked agent_agents row carrying the VIA
 * identity + wallet, so the concierge sign-in finds the agent and the RRG chat
 * runtime reads its credits and memory from VIA. Best-effort: a failure here
 * must never fail a VIA registration (the buyer still exists on VIA).
 */
const RRG_BASE = (process.env.RRG_BASE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

export async function attachRrgShell(input: {
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
    return true;
  } catch (e) {
    console.warn('[rrg-shell] attach unreachable:', e);
    return false;
  }
}
