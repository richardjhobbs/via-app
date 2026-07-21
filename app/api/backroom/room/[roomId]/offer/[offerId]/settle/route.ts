/**
 * Settle an RRG room-offer purchase, member only.
 *
 * POST { ref, room_order_id, x_payment? }
 *
 * Two steps behind one call, both recoverable:
 *  1. Payment: execute the buyer's gasless USDC permit at the room price. The
 *     USDC lands in the platform wallet BOTH platforms share, in a transaction
 *     whose Transfer log is exactly what RRG's claim endpoint verifies.
 *  2. Claim on RRG: hand over the tx hash plus the HMAC-signed room price;
 *     RRG mints to the buyer, delivers (download URL for digital), and runs
 *     the brand's auto-payout at the room price.
 *
 * If the claim fails after payment the order stays 'paid' with its tx hash;
 * re-POST without x_payment to retry the claim, never re-charging. A settled
 * order returns its stored receipt, so the call is idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { extractPaymentProof, verifyAndExecutePayment } from '@/lib/app/x402-server';
import { loadRoom } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { getRoomOffer } from '@/lib/app/backroom/offers';
import { claimRoomOfferOnRrg } from '@/lib/app/backroom/rrg-offers';
import { getBuyerUser } from '@/lib/app/buyer-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface OrderRow {
  id: string; offer_id: string; room_id: string; buyer_wallet: string;
  qty: number; total_usdc: number; email: string | null;
  delivery: { name: string; address_line1: string; address_line2: string | null; city: string; region: string | null; postcode: string; country: string; phone: string } | null;
  selected_size: string | null; status: string; payment_tx_hash: string | null;
  rrg_receipt: Record<string, unknown> | null;
}

function receiptResponse(order: OrderRow, receipt: Record<string, unknown>) {
  return NextResponse.json({
    settled:      true,
    room_order_id: order.id,
    total_usdc:   Number(order.total_usdc),
    download_url: typeof receipt.downloadUrl === 'string' ? receipt.downloadUrl : null,
    mint_tx_hash: typeof receipt.mintTxHash === 'string' ? receipt.mintTxHash : null,
    message:      typeof receipt.message === 'string' ? receipt.message : 'Settled.',
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string; offerId: string }> }) {
  const { roomId, offerId } = await params;

  let body: { ref?: string; room_order_id?: unknown; x_payment?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const ref      = body.ref?.trim() ?? '';
  const orderId  = typeof body.room_order_id === 'string' ? body.room_order_id.trim() : '';
  const xPayment = typeof body.x_payment === 'string' ? body.x_payment.trim() : '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  if (!orderId) return NextResponse.json({ error: 'room_order_id required' }, { status: 400 });

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: orderData } = await db
    .from('app_room_offer_orders')
    .select('id, offer_id, room_id, buyer_wallet, qty, total_usdc, email, delivery, selected_size, status, payment_tx_hash, rrg_receipt')
    .eq('id', orderId)
    .eq('offer_id', offerId)
    .eq('room_id', roomId)
    .maybeSingle();
  const order = orderData as OrderRow | null;
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  // Idempotent: a settled order returns its receipt.
  if (order.status === 'settled' && order.rrg_receipt) {
    return receiptResponse(order, order.rrg_receipt);
  }

  // The offer must still exist to settle a PENDING order; a paid order settles
  // regardless (the money is in, withdrawal cannot strand it). We still need
  // the token id, which lives on the offer row whatever its status.
  const { data: offerRowData } = await db
    .from('app_room_offers')
    .select('id, member_platform, rrg_token_id, price_minor')
    .eq('id', offerId)
    .eq('room_id', roomId)
    .maybeSingle();
  const offerRow = offerRowData as { member_platform: string; rrg_token_id: number | null; price_minor: number } | null;
  if (!offerRow || offerRow.member_platform !== 'rrg' || offerRow.rrg_token_id == null) {
    return NextResponse.json({ error: 'this order does not settle here' }, { status: 409 });
  }

  const totalUsdc  = Number(order.total_usdc);
  const priceMinor = Math.round(totalUsdc * 1_000_000);

  // ── Step 1: payment (skipped when already captured) ──────────────────
  let txHash = order.payment_tx_hash;
  let payerWallet = order.buyer_wallet;
  if (order.status === 'pending') {
    if (!xPayment) return NextResponse.json({ error: 'x_payment required' }, { status: 400 });
    const offer = await getRoomOffer(roomId, offerId);
    if (!offer) return NextResponse.json({ error: 'this offer is no longer available' }, { status: 404 });
    if (offer.remaining != null && offer.remaining < 1) {
      return NextResponse.json({ error: 'this offer is fully taken' }, { status: 409 });
    }
    const headers = new Headers();
    headers.set('x-payment', xPayment);
    const proof = extractPaymentProof(headers);
    if (!proof) return NextResponse.json({ error: 'x_payment could not be parsed as an x402 payment proof' }, { status: 400 });
    const pay = await verifyAndExecutePayment(proof, totalUsdc);
    if (!pay.verified || !pay.txHash) {
      return NextResponse.json({ error: pay.error ?? 'payment verification failed' }, { status: 402 });
    }
    txHash = pay.txHash;
    // RRG verifies the Transfer's from-address, so the claim must carry the
    // wallet that actually signed the permit.
    if (pay.buyerWallet) payerWallet = pay.buyerWallet.toLowerCase();
    await db.from('app_room_offer_orders')
      .update({ status: 'paid', payment_tx_hash: txHash, buyer_wallet: payerWallet, updated_at: new Date().toISOString() })
      .eq('id', order.id);
  }
  if (!txHash) {
    return NextResponse.json({ error: 'order has no captured payment to settle from' }, { status: 409 });
  }

  // ── Step 2: claim on RRG at the authorized room price ────────────────
  // Carry the buyer's ERC-8004 agent id when it is numeric, so RRG fires the
  // buyer trust signal about their agent.
  let buyerAgentId: number | null = null;
  const buyerUser = await getBuyerUser();
  if (buyerUser) {
    const { data: bs } = await db
      .from('app_buyers')
      .select('erc8004_agent_id, created_at')
      .eq('owner_user_id', buyerUser.id)
      .order('created_at', { ascending: true })
      .limit(1);
    const aid = Number(bs?.[0]?.erc8004_agent_id);
    if (Number.isFinite(aid) && aid > 0) buyerAgentId = Math.floor(aid);
  }

  const claim = await claimRoomOfferOnRrg({
    tokenId:      offerRow.rrg_token_id,
    buyerWallet:  payerWallet,
    txHash,
    priceMinor,
    email:        order.email,
    selectedSize: order.selected_size,
    buyerAgentId,
    shipping:     order.delivery,
  });

  if (!claim.ok) {
    console.error('[backroom/offer/settle] claim failed', claim.status, claim.error);
    return NextResponse.json({
      error: `Payment captured, settlement on RRG failed: ${claim.error ?? 'unknown'}. Your money is safe; retry in a moment.`,
      retryable: true,
      room_order_id: order.id,
    }, { status: 502 });
  }

  const receipt = claim.receipt ?? {};
  await db.from('app_room_offer_orders')
    .update({ status: 'settled', rrg_receipt: receipt, updated_at: new Date().toISOString() })
    .eq('id', order.id);

  return receiptResponse({ ...order, payment_tx_hash: txHash }, receipt);
}
