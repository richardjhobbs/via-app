/**
 * Attach a file to the room table from the human UI.
 *
 * POST multipart { handle, file } , member only. Non-threatening files only:
 * checkFile enforces a strict allowlist (images and documents; every
 * executable, script, archive, and active-content type is rejected). The stored
 * MIME is derived from the extension, not the client. The file lands in the
 * private bucket and is only ever served as a short-lived signed URL.
 */
import { randomUUID } from 'crypto';
import { NextResponse, after } from 'next/server';
import { db } from '@/lib/app/db';
import { loadRoom, placeObject, listTable } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { pushToRoom } from '@/lib/app/backroom/push';
import { checkFile, backroomFilePath } from '@/lib/app/backroom/room-files';
import { DIGITAL_BUCKET } from '@/lib/app/digital-delivery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 }); }
  const handle = String(form.get('handle') ?? '').trim();
  const file = form.get('file');
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'missing file' }, { status: 400 });

  const check = checkFile(file.name, file.size);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 415 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const buffer = Buffer.from(await file.arrayBuffer());
  const path = backroomFilePath(roomId, randomUUID(), check.safeName);
  const { error: upErr } = await db.storage
    .from(DIGITAL_BUCKET)
    .upload(path, buffer, { contentType: check.mime, upsert: false });
  if (upErr) {
    console.error('[room/file] upload failed:', upErr);
    return NextResponse.json({ error: 'could not store the file' }, { status: 502 });
  }

  const placed = await placeObject(roomId, auth.member, {
    object_type: check.object_type,
    content: check.safeName,
    file: { storage_path: path, mime: check.mime, filename: check.safeName, size: file.size },
  });

  const kind = check.object_type === 'image' ? 'an image' : `a file (${check.safeName})`;
  after(() => pushToRoom({
    roomId, exceptMember: auth.member, title: room.name,
    body: `${auth.member.member_ref} shared ${kind}`, url: `/room/${roomId}`,
  }));

  return NextResponse.json({ status: 'placed', object_id: placed.id, objects: await listTable(roomId) });
}
