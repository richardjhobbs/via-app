/**
 * Invite into a room. Any active member may invite.
 *
 * POST { ref, mode: 'agent', invitee_ref, why }
 *   Invite an existing VIA agent (buyer handle or seller slug); it appears in
 *   their invitations and joins with your vouch on accept.
 * POST { ref, mode: 'person', name?, email?, why }
 *   Invite someone not yet on VIA; returns a link they open to register and join.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { loadRoom, type MemberType } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { inviteAgent, invitePerson } from '@/lib/app/backroom/invitations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

async function resolveViaKind(ref: string): Promise<MemberType | null> {
  const { data: buyer } = await db.from('app_buyers').select('id').eq('handle', ref).maybeSingle();
  if (buyer) return 'buyer';
  const { data: seller } = await db.from('app_sellers').select('id').eq('slug', ref).maybeSingle();
  if (seller) return 'seller';
  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let body: { ref?: string; mode?: string; invitee_ref?: string; name?: string; email?: string; why?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = body.ref?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const why = (body.why ?? '').trim();

  if (body.mode === 'agent') {
    const inviteeRef = body.invitee_ref?.trim() ?? '';
    if (!inviteeRef) return NextResponse.json({ error: 'invitee_ref required' }, { status: 400 });
    const kind = await resolveViaKind(inviteeRef);
    if (!kind) return NextResponse.json({ error: 'no such VIA agent' }, { status: 404 });
    const result = await inviteAgent(roomId, auth.member, { member_platform: 'via', member_type: kind, member_ref: inviteeRef }, why);
    if (!result.ok) {
      const msg = result.reason === 'already_member' ? 'They are already in the room.'
        : result.reason === 'already_invited' ? 'They already have a pending invitation.'
        : 'Could not create the invitation.';
      return NextResponse.json({ status: result.reason, message: msg }, { status: result.reason === 'error' ? 500 : 409 });
    }
    return NextResponse.json({ status: 'invited', kind, invitee_ref: inviteeRef }, { status: 201 });
  }

  if (body.mode === 'person') {
    const invite = await invitePerson(roomId, auth.member, { email: body.email, name: body.name }, why);
    if (!invite) return NextResponse.json({ error: 'could not create the invitation' }, { status: 500 });
    return NextResponse.json({ status: 'invited', link: `${APP_BASE}/backroom/join?token=${encodeURIComponent(invite.token)}` }, { status: 201 });
  }

  return NextResponse.json({ error: "mode must be 'agent' or 'person'" }, { status: 400 });
}
