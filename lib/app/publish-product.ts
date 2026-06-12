/**
 * Shared product publish (on-chain mint) logic.
 *
 * Extracted verbatim from app/api/seller/[sellerId]/products/[productId]/
 * publish so the dashboard route AND the agent-native management MCP mint
 * through ONE tested code path. Touches the on-chain registerDrop; see
 * lib/app/contract.ts for the creator=PLATFORM_WALLET payout invariant.
 *
 *   1. Guard: product exists, unregistered, no orphaned reserved token_id.
 *   2. Free-tier cap (FREE_LISTED_CAP).
 *   3. Claim next global token_id, reserve it on the row (compare-and-set).
 *   4. registerDrop(tokenId, PLATFORM_WALLET, price_6dp, max_supply).
 *   5. Flip on_chain_status='registered', write tx hash, append audit row.
 *
 * Test mode (+test/+e2e email or VIA_SKIP_ERC8004=1) skips the chain call but
 * still assigns a token_id so list_products can surface the row.
 */

import { db } from './db';
import { getRRGContract, toUsdc6dp } from './contract';
import { PLATFORM_WALLET } from './splits';
import { isTestEmail, shouldSkipErc8004 } from './test-mode';
import { FREE_LISTED_CAP, countListedFor, listedCapReachedMessage } from './limits';
import { validateVinylForPublish } from './vinyl';

const UNLIMITED_SUPPLY = 10_000; // RRG.sol caps edition size at 1-10000

export type PublishProductResult =
  | { ok: true; product: unknown; token_id: number; tx_hash: string; chain_skipped: boolean }
  | { ok: false; status: number; error: string; code?: string; extra?: Record<string, unknown> };

/**
 * Publish (mint) a draft product on-chain. actorUserId is recorded on the
 * audit row. Authorisation (who may call this) is the caller's responsibility:
 * the dashboard route gates on requireBrandAuth, the management MCP gates on a
 * verified store key. Both pass a sellerId already proven to own the product.
 */
export async function publishProduct(
  sellerId: string,
  productId: string,
  actorUserId: string,
): Promise<PublishProductResult> {
  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id, seller_id, title, price_minor, max_supply, on_chain_status, token_id, metadata')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (prodErr) return { ok: false, status: 500, error: prodErr.message };
  if (!product) return { ok: false, status: 404, error: 'Product not found' };
  if (product.on_chain_status === 'registered') {
    return { ok: false, status: 409, code: 'already_published', error: 'Product is already published on-chain' };
  }
  // A non-null token_id on an unregistered row means a prior publish reserved a
  // token but never reached 'registered'. Re-publishing would double-mint.
  if (product.token_id != null) {
    return {
      ok: false, status: 409, code: 'reserved_token',
      error: 'Product has a reserved token_id from a prior publish attempt that did not complete. Reconcile the on-chain state before re-publishing to avoid a duplicate mint.',
      extra: { token_id: product.token_id, on_chain_status: product.on_chain_status },
    };
  }

  // Vinyl integrity gate: a listing carrying a metadata.vinyl block must have
  // a valid media and sleeve grade before it can be minted. Non-vinyl rows
  // pass untouched. See docs/reference_via_vinyl_schema.md.
  const vinylCheck = validateVinylForPublish((product.metadata as Record<string, unknown> | null)?.vinyl);
  if (!vinylCheck.ok) {
    return { ok: false, status: 422, code: 'vinyl_grades_required', error: vinylCheck.error };
  }

  // Free-tier cap: max FREE_LISTED_CAP active + registered products per seller.
  const listedCount = await countListedFor(sellerId);
  if (listedCount >= FREE_LISTED_CAP) {
    return {
      ok: false, status: 409, code: 'free_listed_cap_reached',
      error: listedCapReachedMessage(listedCount),
      extra: { listed: listedCount, cap: FREE_LISTED_CAP },
    };
  }

  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .select('contact_email')
    .eq('id', sellerId)
    .single();
  if (sellerErr || !seller) return { ok: false, status: 500, error: 'Seller row not found' };

  // Claim a global token_id (Postgres sequence shared across all sellers).
  const { data: tokenIdData, error: tokenErr } = await db.rpc('app_next_token_id');
  if (tokenErr || tokenIdData == null) {
    return { ok: false, status: 500, error: `Failed to claim token_id: ${tokenErr?.message ?? 'null'}` };
  }
  const tokenId = Number(tokenIdData);

  // Reserve the claimed token_id BEFORE minting (compare-and-set on token_id IS
  // NULL), so two concurrent publishes cannot both win it and a mid-mint crash
  // leaves a recoverable row the entry guard refuses to re-publish.
  const { data: reserved, error: resErr } = await db
    .from('app_seller_products')
    .update({ token_id: tokenId, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .is('token_id', null)
    .neq('on_chain_status', 'registered')
    .select('id')
    .maybeSingle();
  if (resErr) return { ok: false, status: 500, error: `Failed to reserve token_id: ${resErr.message}`, extra: { token_id_claimed: tokenId } };
  if (!reserved) return { ok: false, status: 409, error: 'Publish already in progress for this product (token_id reserved by a concurrent request).' };

  const maxSupply  = product.max_supply ?? UNLIMITED_SUPPLY;
  const priceMinor = Number(product.price_minor);

  const skipChain = isTestEmail(seller.contact_email) || shouldSkipErc8004(seller.contact_email);

  let txHash: string;
  if (skipChain) {
    txHash = `TEST-skipped-${Date.now().toString(36)}`;
  } else {
    try {
      const contract = getRRGContract();
      const price6dp = toUsdc6dp(priceMinor / 1_000_000); // price_minor is 6dp; toUsdc6dp wants a float
      const tx = await contract.registerDrop(
        BigInt(tokenId),
        PLATFORM_WALLET,
        price6dp,
        BigInt(maxSupply),
      );
      const receipt = await tx.wait(1);
      txHash = receipt.hash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 502, error: `registerDrop failed: ${msg}`, extra: { token_id_claimed: tokenId } };
    }
  }

  const { data: updated, error: updErr } = await db
    .from('app_seller_products')
    .update({
      token_id:         tokenId,
      on_chain_tx_hash: txHash,
      on_chain_status:  'registered',
      updated_at:       new Date().toISOString(),
    })
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .select('id, token_id, on_chain_status, on_chain_tx_hash')
    .single();
  if (updErr) return { ok: false, status: 500, error: updErr.message };

  // Append-only audit row for the mint. Non-fatal: a failed audit write must
  // not roll back a product already minted on-chain, but log loudly.
  try {
    await db.from('app_publish_audit').insert({
      seller_id:     sellerId,
      product_id:    productId,
      actor_user_id: actorUserId,
      token_id:      tokenId,
      tx_hash:       txHash,
      chain_skipped: skipChain,
      price_minor:   priceMinor,
      max_supply:    maxSupply,
    });
  } catch (e) {
    console.error('[publish] audit insert failed', { sellerId, productId, tokenId, txHash, err: e });
  }

  return { ok: true, product: updated, token_id: tokenId, tx_hash: txHash, chain_skipped: skipChain };
}
