/**
 * lib/app/buyer-identity.ts
 *
 * Mint (or relink) the ERC-8004 identity for a buying agent.
 *
 * A buyer's identity lives on THEIR OWN in-app wallet (app_buyers.wallet_address)
 * , the deterministic thirdweb wallet tied to their email (or the external
 * wallet/agent they onboarded with). That single wallet is identity + spend +
 * recognition + delivery: one wallet, linked to the user's real identity.
 *
 * This is deliberately DIFFERENT from seller agents, whose identity wallet stays
 * platform-derived (the central runtime must sign x402 for them). Buyer agents
 * never sign x402 autonomously and reputation feedback is signed by the platform
 * deployer, so the buyer's identity token can simply live on their in-app wallet.
 * One email = one buyer profile, and seller identities never sit on a human's
 * in-app wallet, so the one-token-per-wallet rule is not violated.
 */
import { ethers } from 'ethers';
import { db } from './db';
import { registerAgentIdentity, getAgentIdForWallet } from '@/lib/agent/erc8004';

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
 * Ensure buyer `<buyerId>` has an ERC-8004 identity on their in-app wallet.
 * Idempotent: returns early if an id is already present. Surfaces the registrar
 * error verbatim so a failure is diagnosable rather than silent.
 */
export async function mintBuyerIdentity(buyerId: string, reviewedBy: string): Promise<MintBuyerIdentityResult> {
  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, wallet_address, agent_wallet_address, erc8004_agent_id')
    .eq('id', buyerId)
    .maybeSingle();
  if (error || !buyer)          return { ok: false, error: `buyer "${buyerId}" not found` };
  if (buyer.erc8004_agent_id)   return { ok: true, handle: buyer.handle as string, erc8004_agent_id: buyer.erc8004_agent_id as string, already: true };

  const inApp = (buyer.wallet_address as string | null)?.toLowerCase() ?? null;
  if (!inApp || !ethers.isAddress(inApp)) {
    return { ok: false, handle: buyer.handle as string, error: 'buyer has no valid in-app wallet recorded; cannot mint identity' };
  }

  // Idempotency / cross-platform reuse: if the in-app wallet already owns an
  // ERC-8004 identity (a prior partial run, or the same human's existing agent),
  // link it rather than minting a duplicate.
  try {
    const existing = await getAgentIdForWallet(inApp);
    if (existing != null) {
      const id = existing.toString();
      await db.from('app_buyers').update({ erc8004_agent_id: id, agent_wallet_address: inApp, updated_at: new Date().toISOString() }).eq('id', buyer.id);
      console.log(`[buyer-identity] linked existing erc8004 buyer=${buyer.handle} tokenId=${id} wallet=${inApp} by=${reviewedBy}`);
      return { ok: true, handle: buyer.handle as string, erc8004_agent_id: id, agent_wallet_address: inApp, linked: true };
    }
  } catch (e) {
    console.warn('[buyer-identity] getAgentIdForWallet(in-app) failed; proceeding to mint', e);
  }

  try {
    const { tokenId, txHash } = await registerAgentIdentity(
      buyer.id as string,
      `${buyer.display_name} Buying Agent`,
      inApp,
      'buying_agent',
      `/buyers/${buyer.handle}/mcp`,
    );
    const id = tokenId.toString();
    await db.from('app_buyers').update({ erc8004_agent_id: id, agent_wallet_address: inApp, updated_at: new Date().toISOString() }).eq('id', buyer.id);
    console.log(`[buyer-identity] minted erc8004 buyer=${buyer.handle} tokenId=${id} tx=${txHash} wallet=${inApp} by=${reviewedBy}`);
    return { ok: true, handle: buyer.handle as string, erc8004_agent_id: id, agent_wallet_address: inApp, tx_hash: txHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[buyer-identity] mint failed buyer=${buyer.handle}: ${msg}`);
    return { ok: false, handle: buyer.handle as string, agent_wallet_address: inApp, error: msg };
  }
}
