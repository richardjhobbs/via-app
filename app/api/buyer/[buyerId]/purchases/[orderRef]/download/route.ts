/**
 * Human-facing digital delivery: a buyer's owner clicks "Download" on a paid
 * purchase and lands here. We re-sign a fresh time-limited URL to the private
 * deliverable bucket, gated on (a) the owner being authenticated for this buyer
 * and (b) the purchase belonging to one of this buyer's wallets and being paid.
 *
 * The agent path already returns signed links inline at settlement and via the
 * seller MCP's get_download_links; this is the equivalent surface for the human
 * operator, who has no agent session in front of them.
 *
 * Single file → 302 redirect straight to the signed URL (click = download).
 * Multiple files → JSON list of { filename, url } so the page can render them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { getDigitalFiles, buildDeliverables, ENTITLING_STATUSES } from '@/lib/app/digital-delivery';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buyerId: string; orderRef: string }> },
) {
  const { buyerId, orderRef } = await params;

  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  // The wallets this buyer can claim purchases from: its own payout wallet and
  // its platform-derived agent wallet. A purchase is this buyer's only if it
  // settled from one of them.
  const { data: buyer } = await db
    .from('app_buyers')
    .select('wallet_address, agent_wallet_address, erc8004_agent_id')
    .eq('id', buyerId)
    .maybeSingle();
  if (!buyer) return NextResponse.json({ error: 'buyer not found' }, { status: 404 });
  const wallets = [buyer.wallet_address, buyer.agent_wallet_address]
    .filter((w): w is string => typeof w === 'string' && w.length > 0)
    .map((w) => w.toLowerCase());
  const agentId = typeof buyer.erc8004_agent_id === 'string' && buyer.erc8004_agent_id.trim()
    ? buyer.erc8004_agent_id.trim() : null;

  const { data: purchase } = await db
    .from('app_purchases')
    .select('id, status, buyer_wallet, buyer_agent_id, product:product_id ( id, title, kind, metadata )')
    .eq('order_ref', orderRef)
    .maybeSingle();
  if (!purchase) return NextResponse.json({ error: `order ${orderRef} not found` }, { status: 404 });

  // Ownership: the order is this buyer's if it settled from one of their wallets
  // OR carries their agent id (matches the Purchases page, which lists both).
  const ownsByWallet = wallets.includes(String(purchase.buyer_wallet).toLowerCase());
  const ownsByAgent  = agentId !== null && String(purchase.buyer_agent_id ?? '') === agentId;
  if (!ownsByWallet && !ownsByAgent) {
    return NextResponse.json({ error: 'this order does not belong to your account' }, { status: 403 });
  }
  if (!ENTITLING_STATUSES.includes(String(purchase.status))) {
    return NextResponse.json({ error: 'this order is not paid yet, so there is nothing to download' }, { status: 402 });
  }

  const product = Array.isArray(purchase.product) ? purchase.product[0] : purchase.product;
  const files = getDigitalFiles(product?.metadata);
  if (product?.kind !== 'digital' || files.length === 0) {
    return NextResponse.json({ error: 'this order has no digital deliverable to download' }, { status: 409 });
  }

  let deliverables;
  try {
    deliverables = await buildDeliverables(files);
  } catch (err) {
    console.error(`[buyer/download] ${orderRef} signing failed`, err);
    return NextResponse.json({ error: 'could not generate the download link, try again' }, { status: 500 });
  }

  // One file: send the buyer straight to it. Many: hand back the list.
  if (deliverables.length === 1) {
    return NextResponse.redirect(deliverables[0].url, 302);
  }
  return NextResponse.json({ order_ref: orderRef, files: deliverables });
}
