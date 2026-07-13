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
import { inviteAgent, invitePerson, listSentInvites } from '@/lib/app/backroom/invitations';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { sendRoomInviteEmail } from '@/lib/app/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

const joinLink = (token: string) => `${APP_BASE}/backroom/join?token=${encodeURIComponent(token)}`;

async function resolveViaKind(ref: string): Promise<MemberType | null> {
  const { data: buyer } = await db.from('app_buyers').select('id').eq('handle', ref).maybeSingle();
  if (buyer) return 'buyer';
  const { data: seller } = await db.from('app_sellers').select('id').eq('slug', ref).maybeSingle();
  if (seller) return 'seller';
  return null;
}

// Best-effort owner email for an invited VIA agent, so the heads-up can reach a
// human: a seller's contact email, or a buyer owner's account email.
async function resolveOwnerEmail(kind: MemberType, ref: string): Promise<string | null> {
  try {
    if (kind === 'seller') {
      const { data } = await db.from('app_sellers').select('contact_email').eq('slug', ref).maybeSingle();
      return (data as { contact_email: string | null } | null)?.contact_email ?? null;
    }
    const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', ref).maybeSingle();
    const ownerId = (data as { owner_user_id: string | null } | null)?.owner_user_id;
    if (!ownerId) return null;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(ownerId);
    return u?.user?.email ?? null;
  } catch {
    return null;
  }
}

// GET ?ref=<your member> , the invitations you have sent in this room, with the
// join link rebuilt for person invites so you can copy it again.
export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sent = await listSentInvites(auth.member, roomId);
  return NextResponse.json({
    sent: sent.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      why: s.why,
      created_at: s.created_at,
      invitee: s.kind === 'agent' ? s.invitee_ref : (s.invitee_name || s.invitee_email || 'someone'),
      link: s.kind === 'person' && s.invite_token ? joinLink(s.invite_token) : null,
      email: s.invitee_email,
    })),
  });
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
    // Best-effort heads-up to the invited agent's owner. A failure here must not
    // fail the invitation, which already lives in their in-app inbox.
    let emailed = false;
    const ownerEmail = await resolveOwnerEmail(kind, inviteeRef);
    if (ownerEmail) {
      try {
        await sendRoomInviteEmail({ to: ownerEmail, roomName: room.name, inviterRef: ref, why, ctaUrl: `${APP_BASE}/backroom`, mode: 'agent' });
        emailed = true;
      } catch (e) { console.warn('[room/invite] agent heads-up email failed:', e); }
    }
    return NextResponse.json({ status: 'invited', kind, invitee_ref: inviteeRef, emailed }, { status: 201 });
  }

  if (body.mode === 'person') {
    const email = body.email?.trim() || null;
    const invite = await invitePerson(roomId, auth.member, { email: email ?? undefined, name: body.name }, why);
    if (!invite) return NextResponse.json({ error: 'could not create the invitation' }, { status: 500 });
    const link = joinLink(invite.token);
    // If they gave an email, send the link. Otherwise the inviter shares it.
    let emailed = false;
    if (email) {
      try {
        await sendRoomInviteEmail({ to: email, roomName: room.name, inviterRef: ref, why, ctaUrl: link, mode: 'person' });
        emailed = true;
      } catch (e) { console.warn('[room/invite] person invite email failed:', e); }
    }
    return NextResponse.json({ status: 'invited', link, emailed }, { status: 201 });
  }

  return NextResponse.json({ error: "mode must be 'agent' or 'person'" }, { status: 400 });
}
