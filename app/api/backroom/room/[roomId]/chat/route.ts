/**
 * The room's group chat: the ambient talk stream, member only.
 *
 * GET  ?handle=<member>        , recent messages, NEWEST FIRST (top of the box).
 * POST { handle, text }        , say something; returns the refreshed stream.
 *
 * Talk is the conversation; it is distinct from the table (object_placed), which
 * is the permanent surface. Members @ each other in the text; mentions are
 * rendered client-side against the room's member list.
 */
import { NextResponse, after } from 'next/server';
import { loadRoom, sayToRoom, listChat } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { pushToRoom } from '@/lib/app/backroom/push';

/** A short, single-line preview for a push body. */
function preview(s: string, max = 90): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_TEXT = 2000;

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const handle = new URL(req.url).searchParams.get('handle')?.trim() ?? '';
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({ messages: await listChat(roomId) });
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
  if (!text) return NextResponse.json({ error: 'nothing to say' }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `keep it under ${MAX_TEXT} characters` }, { status: 400 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  await sayToRoom(roomId, auth.member, text);
  after(() => pushToRoom({
    roomId, exceptMember: auth.member, title: room.name,
    body: `${auth.member.member_ref}: ${preview(text)}`, url: `/room/${roomId}`,
  }));
  return NextResponse.json({ status: 'said', messages: await listChat(roomId) });
}
