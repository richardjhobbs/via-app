import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { getRRGContract, toUsdc6dp } from '@/lib/app/contract';
import { PLATFORM_WALLET } from '@/lib/app/splits';
import { isTestEmail, shouldSkipErc8004 } from '@/lib/app/test-mode';
import { FREE_LISTED_CAP, countListedFor, listedCapReachedMessage } from '@/lib/app/limits';

export const dynamic = 'force-dynamic';

const UNLIMITED_SUPPLY = 1_000_000_000; // 1e9 sentinel matches VIANetwork.sol cap

/**
 * POST /api/seller/[sellerId]/products/[productId]/publish
 *
 * Mint the product on the VIA ERC-1155 contract:
 *   1. Claim next global token_id via app_next_token_id RPC.
 *   2. Fire registerDrop(tokenId, PLATFORM_WALLET, price_6dp, max_supply).
 *      `creator` must be PLATFORM_WALLET so the 97.5/2.5 auto-payout
 *      pattern works — see [lib/app/contract.ts:5-15] post-mortem.
 *   3. Update the row: token_id, on_chain_tx_hash, on_chain_status='registered'.
 *
 * Test mode: when the seller's contact_email matches the +test/+e2e alias
 * regex OR VIA_SKIP_ERC8004=1, skip the on-chain mint and still assign a
 * synthetic token_id from the same sequence so MCP list_products can
 * return the row. The on_chain_tx_hash field gets a "TEST-skipped" marker
 * so it's identifiable.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  // Load product + seller (for test-mode detection)
  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id, seller_id, title, price_minor, max_supply, on_chain_status, token_id')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  if (product.on_chain_status === 'registered') {
    return NextResponse.json({ error: 'Product is already published on-chain', product }, { status: 409 });
  }

  // Free-tier cap: max FREE_LISTED_CAP active + registered products per seller.
  const listedCount = await countListedFor(sellerId);
  if (listedCount >= FREE_LISTED_CAP) {
    return NextResponse.json({
      error: listedCapReachedMessage(listedCount),
      code: 'free_listed_cap_reached',
      listed: listedCount,
      cap: FREE_LISTED_CAP,
    }, { status: 409 });
  }

  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .select('contact_email')
    .eq('id', sellerId)
    .single();
  if (sellerErr || !seller) {
    return NextResponse.json({ error: 'Seller row not found' }, { status: 500 });
  }

  // Claim a global token_id (Postgres sequence shared across all sellers).
  const { data: tokenIdData, error: tokenErr } = await db.rpc('app_next_token_id');
  if (tokenErr || tokenIdData == null) {
    return NextResponse.json({ error: `Failed to claim token_id: ${tokenErr?.message ?? 'null'}` }, { status: 500 });
  }
  const tokenId = Number(tokenIdData);

  const maxSupply = product.max_supply ?? UNLIMITED_SUPPLY;
  const priceMinor = Number(product.price_minor);

  const skipChain = isTestEmail(seller.contact_email) || shouldSkipErc8004(seller.contact_email);

  let txHash: string;
  if (skipChain) {
    txHash = `TEST-skipped-${Date.now().toString(36)}`;
  } else {
    try {
      const contract = getRRGContract();
      // toUsdc6dp wants a human float; price_minor is already 6dp so divide.
      const price6dp = toUsdc6dp(priceMinor / 1_000_000);
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
      return NextResponse.json({
        error: `registerDrop failed: ${msg}`,
        token_id_claimed: tokenId,
      }, { status: 502 });
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

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    product:    updated,
    token_id:   tokenId,
    tx_hash:    txHash,
    chain_skipped: skipChain,
  });
}
