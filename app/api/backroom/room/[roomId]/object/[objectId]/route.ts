/**
 * Delete a post from the room table. Founder or superadmin only.
 *
 * DELETE ?ref=<founder handle>   , the room's founder (acting as ref) removes a
 * post; a superadmin (admin cookie) may remove any post in any room without a
 * ref. Removing an image/file post also deletes its stored file.
 */
import { NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { loadRoom, isFounder, deleteRoomObject } from '@/lib/app/backroom/rooms';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ roomId: string; objectId: string }> }) {
  const { roomId, objectId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  // Superadmin may delete any post; otherwise the caller must be the founder.
  let authorized = await isAdminFromCookies();
  if (!authorized) {
    const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
    if (!ref) return NextResponse.json({ error: 'ref required (the founder you are acting as)' }, { status: 400 });
    const owned = await resolveOwnedMember(ref);
    if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
    authorized = await isFounder(roomId, owned.member);
    if (!authorized) return NextResponse.json({ error: 'only the room founder or a superadmin can delete posts' }, { status: 403 });
  }

  const ok = await deleteRoomObject(roomId, objectId);
  if (!ok) return NextResponse.json({ error: 'post not found' }, { status: 404 });
  return NextResponse.json({ status: 'deleted', object_id: objectId });
}
