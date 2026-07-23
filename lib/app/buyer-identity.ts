/**
 * lib/app/buyer-identity.ts
 *
 * Mint the ERC-8004 identity for a buying agent.
 *
 * A buyer's identity token lives on a PLATFORM-DERIVED identity wallet (derived
 * from AGENT_WALLET_SEED + buyer id, re-derivable, never stored), the same
 * scheme sellers use. This is DISTINCT from the buyer's own thirdweb spend
 * wallet (app_buyers.wallet_address), which the buyer alone controls and which
 * the platform cannot sign for. Minting from a wallet the platform can operate
 * is what lets the token be self-custodied on-chain rather than parked in a
 * shared registrar wallet; the spend wallet stays entirely the buyer's.
 *
 * The buying agent never signs x402 (sellers pay the micro-fees) and reputation
 * is signed by the platform deployer, so the identity wallet only ever needs gas
 * to register or update its own token.
 */
import { db } from './db';
import { selfMintAgentIdentity } from '@/lib/agent/erc8004';

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
 * Ensure buyer `<buyerId>` has a self-custodied ERC-8004 identity on their
 * platform-derived identity wallet. Idempotent: returns early if an id is
 * already present (and selfMintAgentIdentity links rather than re-mints if the
 * derived wallet already owns a token). Surfaces the mint error verbatim so a
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

  const name = (buyer.display_name as string | null) || (buyer.handle as string);
  try {
    const { tokenId, wallet, txHash } = await selfMintAgentIdentity(
      buyer.id as string,
      `${name} Buying Agent`,
      `Buying agent on VIA for ${name}.`,
      'buying_agent',
      `/buyers/${buyer.handle}/mcp`,
      { handle: buyer.handle },
    );
    const id = tokenId.toString();
    await db.from('app_buyers').update({ erc8004_agent_id: id, agent_wallet_address: wallet, updated_at: new Date().toISOString() }).eq('id', buyer.id);
    console.log(`[buyer-identity] self-minted erc8004 buyer=${buyer.handle} tokenId=${id} owner=${wallet} tx=${txHash} by=${reviewedBy}`);
    return { ok: true, handle: buyer.handle as string, erc8004_agent_id: id, agent_wallet_address: wallet, tx_hash: txHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[buyer-identity] mint failed buyer=${buyer.handle}: ${msg}`);
    return { ok: false, handle: buyer.handle as string, error: msg };
  }
}
