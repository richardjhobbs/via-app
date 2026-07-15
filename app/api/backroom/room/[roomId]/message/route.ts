/**
 * Put a text note on the room table from the human UI.
 *
 * POST { handle, text } , member only. Voice is promoted, but text is here for
 * anyone who would rather type. It places the same 'note' object the voice loop
 * and the MCP place the table's other notes as, so it reads identically.
 */
import { NextResponse, after } from 'next/server';
import { loadRoom, placeObject, listTable } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { pushToRoom } from '@/lib/app/backroom/push';

/** A short, single-line preview for a push body. */
function preview(s: string, max = 90): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_TEXT = 4000;

// A bare URL typed on its own reads better as a link card than a note.
function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s) || /^www\.\S+\.\S+$/i.test(s);
}

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let body: { handle?: string; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const handle = body.handle?.trim() ?? '';
  const text = (body.text ?? '').trim();
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'nothing to place' }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `keep it under ${MAX_TEXT} characters` }, { status: 400 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const placed = await placeObject(roomId, auth.member, {
    object_type: isUrl(text) ? 'link' : 'note',
    content: text,
  });

  after(() => pushToRoom({
    roomId, exceptMember: auth.member, title: room.name,
    body: `${auth.member.member_ref} added to the table: ${preview(text)}`, url: `/room/${roomId}`,
  }));

  return NextResponse.json({ status: 'placed', object_id: placed.id, objects: await listTable(roomId) });
}
