/**
 * Withdraw an in-room offer: the store that posted it, or a room founder.
 * DELETE ?ref=
 */
import { NextResponse } from 'next/server';
import { loadRoom } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { withdrawRoomOffer, listRoomOffers } from '@/lib/app/backroom/offers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ roomId: string; offerId: string }> }) {
  const { roomId, offerId } = await params;
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await withdrawRoomOffer(roomId, offerId, auth.member);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ status: 'withdrawn', offers: await listRoomOffers(roomId) });
}
