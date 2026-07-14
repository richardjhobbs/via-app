/**
 * Ask a matched agent in the room for one co-creation idea (the member-triggered
 * carve-out to the no-AI-past-introduction invariant).
 *
 * POST { handle, from_ref, from_platform?, from_type?, prompt? }
 *   -> returns an attributed suggestion. Nothing is placed on the table.
 * POST { handle, action:'accept', suggestion:{...} }
 *   -> the human accepts: the suggestion lands on the table as an attributed note.
 *
 * Only a room member can ask; the suggestion is always attributed and requires
 * this explicit human accept before it becomes a table object.
 */
import { NextResponse } from 'next/server';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { isMember, placeObject, type Author, type MemberPlatform, type MemberType } from '@/lib/app/backroom/rooms';
import { suggestCollab, suggestionNote, type CollabSuggestion } from '@/lib/app/backroom/suggest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  let body: {
    handle?: string; ref?: string; action?: string; prompt?: string;
    from_ref?: string; from_platform?: string; from_type?: string;
    suggestion?: CollabSuggestion;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = (body.ref ?? body.handle)?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Accept: place the (already-shown) suggestion on the table, attributed.
  if (body.action === 'accept') {
    const s = body.suggestion;
    if (!s || !s.title) return NextResponse.json({ error: 'suggestion required' }, { status: 400 });
    await placeObject(roomId, auth.member, { object_type: 'note', content: suggestionNote(s) });
    return NextResponse.json({ ok: true, placed: true });
  }

  // Draft: ask the named agent (a room member) for an idea. Attributed, ephemeral.
  const fromRef = body.from_ref?.trim() ?? '';
  if (!fromRef) return NextResponse.json({ error: 'from_ref required' }, { status: 400 });
  const from: Author = {
    member_platform: (body.from_platform as MemberPlatform) ?? 'rrg',
    member_type: (body.from_type as MemberType) ?? 'buyer',
    member_ref: fromRef,
  };
  if (!(await isMember(roomId, from.member_platform, from.member_type, from.member_ref))) {
    return NextResponse.json({ error: 'that agent is not a member of this room' }, { status: 400 });
  }

  const suggestion = await suggestCollab(from, auth.member, body.prompt);
  if (!suggestion) return NextResponse.json({ error: 'could not generate a suggestion right now' }, { status: 503 });
  return NextResponse.json({ ok: true, suggestion });
}
