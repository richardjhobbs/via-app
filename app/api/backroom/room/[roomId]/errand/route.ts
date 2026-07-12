/**
 * Room errands. VIA sources over the existing rails and, once the member has
 * paid through the existing x402 door, records the result on the table.
 *
 * POST { handle, action: 'quote', request }        , source and price something.
 * POST { handle, action: 'record', order_ref }      , after the member has paid
 *   at the existing checkout, pull the settled order and place its result on the
 *   table (the result the human chose to bring back into the room).
 *
 * No new payment machinery: paying happens at the existing product checkout
 * (the deliberate press, over the same x402 path as every other purchase). This
 * route only quotes and records, upholding the paid-door invariant.
 */
import { NextResponse } from 'next/server';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { loadRoom, placeErrandResult } from '@/lib/app/backroom/rooms';
import { loadOrderByRef } from '@/lib/app/orders';
import { dryRunMatch } from '@/lib/app/buyer-matching';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SETTLED = new Set(['paid', 'minted', 'paid_out']);

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let body: { handle?: string; action?: string; request?: string; order_ref?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const handle = body.handle?.trim() ?? '';
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (body.action === 'quote') {
    const request = body.request?.trim() ?? '';
    if (!request) return NextResponse.json({ error: 'request required' }, { status: 400 });
    const { intent, results } = await dryRunMatch(request);
    return NextResponse.json({ status: 'quotes', understood: intent, count: results.length, quotes: results });
  }

  if (body.action === 'record') {
    const orderRef = body.order_ref?.trim() ?? '';
    if (!orderRef) return NextResponse.json({ error: 'order_ref required' }, { status: 400 });
    const order = await loadOrderByRef(orderRef);
    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });
    if (!SETTLED.has(order.status)) {
      // Money out is never assumed. If the order has not settled through the
      // existing x402 door, nothing is placed.
      return NextResponse.json({ status: 'not_settled', order_status: order.status });
    }
    const summary = `${order.product.title} from ${order.seller.name}, ${order.total_usdc} USDC`;
    const placed = await placeErrandResult(roomId, auth.member, {
      object_type: 'errand_result',
      content: summary,
      summary,
      order_ref: order.order_ref,
      seller: order.seller.name,
      title: order.product.title,
      total_usdc: order.total_usdc,
      mint_tx_hash: order.mint_tx_hash,
    });
    return NextResponse.json({ status: 'placed', object_id: placed.id, summary });
  }

  return NextResponse.json({ error: "action must be 'quote' or 'record'" }, { status: 400 });
}
