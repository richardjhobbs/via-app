/**
 * POST /api/buyer/[buyerId]/purchase  { match_id, confirm? }
 *
 * The buyer agent fulfils a discovered match: create order -> sign permit ->
 * settle on-chain (mint receipt + pay seller + reputation). Owner-authed: only
 * the buyer's owner can release a purchase.
 *
 * Returns one of:
 *   { status: 'needs_confirmation', ... }  amount above the auto-buy cap; re-POST with confirm:true
 *   { status: 'settled', order_ref, payment_tx_hash, mint_tx_hash, ... }
 *   { status: 'rejected' | 'unsupported' | 'error', ... }
 *
 * The owner-confirm beat IS the point: within the buyer's auto-buy cap the agent
 * settles autonomously; above it the agent stops and asks the human, who taps
 * once to release. No wallet popup , the platform agent wallet signs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { fulfilMatchById, type DeliveryInput } from '@/lib/app/buyer-fulfilment';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: { match_id?: unknown; confirm?: unknown; delivery?: unknown; buyer_country?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ status: 'error', message: 'invalid JSON body' }, { status: 400 }); }

  const matchId = String(body.match_id ?? '').trim();
  if (!matchId) return NextResponse.json({ status: 'error', message: 'match_id is required' }, { status: 400 });

  const delivery = body.delivery && typeof body.delivery === 'object' && !Array.isArray(body.delivery)
    ? (body.delivery as DeliveryInput)
    : null;
  const buyerCountry = typeof body.buyer_country === 'string' ? body.buyer_country : null;

  const result = await fulfilMatchById(buyerId, matchId, {
    confirmedByOwner: body.confirm === true,
    delivery,
    buyerCountry,
  });

  const httpStatus =
    result.status === 'settled'           ? 200 :
    result.status === 'needs_confirmation' ? 200 :
    result.status === 'rejected'           ? 409 :
    result.status === 'unsupported'        ? 409 :
    /* error */                              502;

  return NextResponse.json(result, { status: httpStatus });
}
