/**
 * The Room, for the human UI: the table and the room's warmth.
 *
 * GET ?handle=<buyer> , the objects on the table plus presence warmth. Members
 * only (owner session + room membership).
 */
import { NextResponse } from 'next/server';
import { loadRoom, listTable, roomWarmth } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const handle = new URL(req.url).searchParams.get('handle')?.trim() ?? '';
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [objects, warmth] = await Promise.all([listTable(roomId), roomWarmth(roomId)]);
  return NextResponse.json({
    room: { id: room.id, name: room.name, accent_hex: room.accent_hex, member_cap: room.member_cap },
    warmth,
    count: objects.length,
    objects,
  });
}
