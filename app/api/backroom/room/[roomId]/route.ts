/**
 * The Room, for the human UI: the table and the room's warmth.
 *
 * GET ?handle=<buyer> , the objects on the table plus presence warmth. Members
 * only (owner session + room membership).
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { loadRoom, listTable, roomWarmth } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { isAdminFromCookies } from '@/lib/app/auth';
import { DIGITAL_BUCKET } from '@/lib/app/digital-delivery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const handle = new URL(req.url).searchParams.get('handle')?.trim() ?? '';

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  // A member opens the room with their handle; a superadmin may open any room
  // read-only for oversight (no handle needed).
  if (handle) {
    const auth = await requireRoomMember(handle, roomId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  } else if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 });
  }

  const [objects, warmth] = await Promise.all([listTable(roomId), roomWarmth(roomId)]);

  // File/image objects are stored privately; hand the client a short-lived
  // signed URL so it can render an image or offer a download. Sign each path
  // individually: the batch createSignedUrls returns the key URL-encoded, so a
  // key with a space (e.g. "composed 5.jpg") would never match a by-path lookup
  // and the image would silently fail to render.
  const withUrls = await Promise.all(objects.map(async (o) => {
    if (!o.storage_path) return { ...o, url: null as string | null };
    const { data } = await db.storage.from(DIGITAL_BUCKET).createSignedUrl(o.storage_path, 3600);
    return { ...o, url: data?.signedUrl ?? null };
  }));

  return NextResponse.json({
    room: { id: room.id, name: room.name, accent_hex: room.accent_hex, member_cap: room.member_cap },
    warmth,
    count: withUrls.length,
    objects: withUrls,
  });
}
