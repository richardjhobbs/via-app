/**
 * In-room exclusive offers, for the human UI.
 *
 * GET  ?ref=  , member only: the room's active offers, plus (when the caller is
 *              a VIA seller member) the offerable products of THEIR store for
 *              the composer.
 * POST { ref, product_id, price_usd, terms?, qty_cap? } , VIA seller member
 *              only: put one of your products in front of the room at a room
 *              price. The room is notified.
 */
import { NextResponse, after } from 'next/server';
import { loadRoom } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { createRoomOffer, listRoomOffers, listOfferableProducts, listOfferableRrgProducts } from '@/lib/app/backroom/offers';
import { pushToRoom } from '@/lib/app/backroom/push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const offers = await listRoomOffers(roomId);
  // The composer catalogue for a brand member: a VIA store's own products, or
  // an RRG brand's live drops over the signed federation call.
  let yourProducts: Awaited<ReturnType<typeof listOfferableProducts>> = [];
  let catalogueError: string | null = null;
  if (auth.member.member_type === 'seller') {
    if (auth.member.member_platform === 'via') {
      yourProducts = await listOfferableProducts(auth.member.member_ref);
    } else {
      const rrg = await listOfferableRrgProducts(auth.member.member_ref);
      if (rrg === null) catalogueError = 'could not reach RRG for your catalogue; try again in a minute';
      else yourProducts = rrg;
    }
  }
  return NextResponse.json({ offers, your_products: yourProducts, ...(catalogueError ? { catalogue_error: catalogueError } : {}) });
}

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let body: { ref?: string; product_id?: string; price_usd?: number; terms?: string; qty_cap?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = body.ref?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  if (!body.product_id || typeof body.product_id !== 'string') {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 });
  }

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await createRoomOffer(roomId, auth.member, {
    product_id: body.product_id,
    price_usd:  Number(body.price_usd),
    terms:      typeof body.terms === 'string' ? body.terms : null,
    qty_cap:    body.qty_cap != null ? Number(body.qty_cap) : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const offer = result.offer;
  after(() => pushToRoom({
    roomId, exceptMember: auth.member, title: room.name,
    body: `${offer.seller_name} has an offer for the room: ${offer.title} at ${offer.price_usdc.toFixed(2)} USDC`,
    url: `/room/${roomId}`,
  }));

  return NextResponse.json({ status: 'offered', offer, offers: await listRoomOffers(roomId) });
}
