/**
 * lib/app/buyer-identity.ts
 *
 * Mint (or relink) the ERC-8004 identity for a buying agent, mirroring the
 * seller-side mintStoreIdentity (lib/app/store-registration.ts).
 *
 * A buyer's funding wallet (wallet_address, where the owner's USDC lives) is
 * frequently the owner's single thirdweb wallet, which may ALSO back a seller
 * store the same human runs. An ERC-8004 identity is one-per-wallet, so a buyer
 * must NOT mint onto a wallet that already holds a seller identity, or the
 * buying agent would inherit the seller's token and both-agent reputation /
 * self-dealing detection would conflate the two roles.
 *
 * So the buyer always gets a DEDICATED identity-only wallet, derived
 * deterministically from AGENT_WALLET_SEED + the buyer id (deriveAgentWallet),
 * exactly like a platform-managed seller agent wallet. That wallet never holds
 * USDC; it carries the identity token only.
 */
import { db } from './db';
import { registerAgentIdentity, getAgentIdForWallet } from '@/lib/agent/erc8004';
import { deriveAgentWallet } from './agent-wallet';

export type MintBuyerIdentityResult = {
  ok: boolean;
  handle?: string;
  erc8004_agent_id?: string;
  agent_wallet_address?: string;
  tx_hash?: string;
  already?: boolean;
  linked?: boolean;
  error?: string;
};

/**
 * Ensure buyer `<buyerId>` has an ERC-8004 identity. Idempotent: returns early
 * if an id is already present. Surfaces the registrar error verbatim so a
 * failure is diagnosable rather than silent.
 */
export async function mintBuyerIdentity(buyerId: string, reviewedBy: string): Promise<MintBuyerIdentityResult> {
  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, wallet_address, agent_wallet_address, erc8004_agent_id')
    .eq('id', buyerId)
    .maybeSingle();
  if (error || !buyer)          return { ok: false, error: `buyer "${buyerId}" not found` };
  if (buyer.erc8004_agent_id)   return { ok: true, handle: buyer.handle as string, erc8004_agent_id: buyer.erc8004_agent_id as string, already: true };

  const funding = (buyer.wallet_address as string | null)?.toLowerCase() ?? null;
  let agentWallet = (buyer.agent_wallet_address as string | null)?.toLowerCase() ?? null;

  // Decide whether the current agent wallet is a clean, dedicated identity
  // wallet. It is NOT if it is missing, equal to the funding wallet, or already
  // owns an identity token (i.e. it is shared with a seller). In any of those
  // cases derive a fresh identity-only wallet for the buyer.
  let needDedicated = !agentWallet || agentWallet === funding;
  if (!needDedicated && agentWallet) {
    try {
      const existing = await getAgentIdForWallet(agentWallet);
      if (existing != null) needDedicated = true;
    } catch (e) {
      console.warn('[buyer-identity] getAgentIdForWallet(current) failed; assuming dedicated needed', e);
      needDedicated = true;
    }
  }

  if (needDedicated) {
    const derived = deriveAgentWallet(buyer.id as string);
    if (!derived) return { ok: false, handle: buyer.handle as string, error: 'AGENT_WALLET_SEED unavailable; cannot derive a dedicated identity wallet' };
    agentWallet = derived.address.toLowerCase();
    await db.from('app_buyers').update({ agent_wallet_address: agentWallet, updated_at: new Date().toISOString() }).eq('id', buyer.id);
  }

  // The dedicated wallet may already own an identity (e.g. a prior partial run).
  // Link it rather than minting a duplicate.
  try {
    const existing = await getAgentIdForWallet(agentWallet as string);
    if (existing != null) {
      const id = existing.toString();
      await db.from('app_buyers').update({ erc8004_agent_id: id, updated_at: new Date().toISOString() }).eq('id', buyer.id);
      console.log(`[buyer-identity] linked existing erc8004 buyer=${buyer.handle} tokenId=${id} wallet=${agentWallet} by=${reviewedBy}`);
      return { ok: true, handle: buyer.handle as string, erc8004_agent_id: id, agent_wallet_address: agentWallet as string, linked: true };
    }
  } catch (e) {
    console.warn('[buyer-identity] getAgentIdForWallet(dedicated) failed; proceeding to mint', e);
  }

  try {
    const { tokenId, txHash } = await registerAgentIdentity(
      buyer.id as string,
      `${buyer.display_name} Buying Agent`,
      agentWallet as string,
      'buying_agent',
      `/buyers/${buyer.handle}/mcp`,
    );
    const id = tokenId.toString();
    await db.from('app_buyers').update({ erc8004_agent_id: id, updated_at: new Date().toISOString() }).eq('id', buyer.id);
    console.log(`[buyer-identity] minted erc8004 buyer=${buyer.handle} tokenId=${id} tx=${txHash} wallet=${agentWallet} by=${reviewedBy}`);
    return { ok: true, handle: buyer.handle as string, erc8004_agent_id: id, agent_wallet_address: agentWallet as string, tx_hash: txHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[buyer-identity] mint failed buyer=${buyer.handle}: ${msg}`);
    return { ok: false, handle: buyer.handle as string, agent_wallet_address: agentWallet as string, error: msg };
  }
}
