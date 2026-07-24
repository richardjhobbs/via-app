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
import { resolveRrgConcierge, resolveRrgBrand } from '@/lib/app/backroom/rrg-federation';
import { getPublishedCardForMember, cardUrl } from '@/lib/app/backroom/taste-cards';
import type { Author } from '@/lib/app/backroom/rooms';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { sendRoomInviteEmail } from '@/lib/app/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

const joinLink = (token: string) => `${APP_BASE}/backroom/join?token=${encodeURIComponent(token)}`;

// Handles and slugs are stored lowercase; a typed "RJH" must still find rjh.
function slugPattern(ref: string): string {
  return ref.trim().replace(/([%_\\])/g, '\\$1');
}
async function resolveViaKind(ref: string): Promise<{ kind: MemberType; ref: string } | null> {
  const pat = slugPattern(ref);
  if (!pat) return null;
  const { data: buyer } = await db.from('app_buyers').select('handle').ilike('handle', pat).maybeSingle();
  if (buyer) return { kind: 'buyer', ref: (buyer as { handle: string }).handle };
  const { data: seller } = await db.from('app_sellers').select('slug').ilike('slug', pat).maybeSingle();
  if (seller) return { kind: 'seller', ref: (seller as { slug: string }).slug };
  return null;
}

// An imported concierge IS its VIA buyer: route the invitation to the one
// agent, never to the federated identity.
async function importedBuyerForWallet(wallet: string | null): Promise<string | null> {
  if (!wallet) return null;
  const { data } = await db
    .from('app_buyers')
    .select('handle')
    .not('linked_rrg_agent_id', 'is', null)
    .ilike('wallet_address', wallet)
    .maybeSingle();
  return (data as { handle: string } | null)?.handle ?? null;
}

// The inviter's published taste card URL, if they have one: the invitation's
// "who is asking", carried on the email in the inviter's own words.
async function inviterCardUrl(member: Author): Promise<string | null> {
  try {
    const card = await getPublishedCardForMember(member.member_platform, member.member_type, member.member_ref);
    return card ? cardUrl(card) : null;
  } catch {
    return null;
  }
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
      // Who actually redeemed a person invite (recorded at join). Shown so an
      // invite consumed by a forwarded link reads honestly in the outbox.
      joined_as: s.kind === 'person' && s.status === 'accepted' ? s.invitee_ref : null,
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
    const viaAgent = await resolveViaKind(inviteeRef);
    if (viaAgent) {
      // VIA agent: create an invitation it accepts from its VIA hub.
      const result = await inviteAgent(roomId, auth.member, { member_platform: 'via', member_type: viaAgent.kind, member_ref: viaAgent.ref }, why);
      if (!result.ok) {
        const msg = result.reason === 'already_member' ? 'They are already in the room.'
          : result.reason === 'already_invited' ? 'They already have a pending invitation.'
          : 'Could not create the invitation.';
        return NextResponse.json({ status: result.reason, message: msg }, { status: result.reason === 'error' ? 500 : 409 });
      }
      // Best-effort heads-up to the invited agent's owner. A failure here must
      // not fail the invitation, which already lives in their in-app inbox.
      let emailed = false;
      const ownerEmail = await resolveOwnerEmail(viaAgent.kind, viaAgent.ref);
      if (ownerEmail) {
        try {
          await sendRoomInviteEmail({ to: ownerEmail, roomName: room.name, inviterRef: ref, why, ctaUrl: `${APP_BASE}/backroom`, mode: 'agent', inviterCardUrl: await inviterCardUrl(auth.member) });
          emailed = true;
        } catch (e) { console.warn('[room/invite] agent heads-up email failed:', e); }
      }
      return NextResponse.json({ status: 'invited', kind: viaAgent.kind, invitee_ref: viaAgent.ref, emailed }, { status: 201 });
    }

    // Not a VIA agent: try RRG. Since the Back Room handoff, every RRG agent
    // has an inbox here too, so an RRG invitee gets the SAME consent flow as a
    // VIA one: a pending invitation in their hub, accepted by them, never a
    // silent seat. Their wallet is cached at accept time from their session.
    // Resolved by VIA id, wallet, or unique name for a concierge, or brand slug.
    const resolved = await resolveRrgConcierge(inviteeRef);
    // An RRG blip must NOT read as "no such agent": that message sends the
    // inviter down the person-link path for someone who has an agent.
    if (resolved === 'unavailable') {
      return NextResponse.json({ error: 'Could not reach RRG to check that agent just now. Nothing was created; try again in a minute.' }, { status: 503 });
    }
    const concierge = resolved;
    const brand = concierge ? null : await resolveRrgBrand(inviteeRef);
    const rrgKind: MemberType | null = concierge ? 'buyer' : brand ? 'seller' : null;
    const identity = concierge ?? brand;
    if (!rrgKind || !identity) {
      return NextResponse.json({ error: `No agent named "${inviteeRef}" on VIA or RRG. Check their exact handle or store slug. Only use the person invite for someone without an agent.` }, { status: 404 });
    }

    // An imported concierge IS its VIA buyer: address the invitation to the
    // one agent so it lands in the owner's ordinary VIA inbox.
    if (rrgKind === 'buyer') {
      const importedHandle = await importedBuyerForWallet(concierge?.wallet_address ?? null);
      if (importedHandle) {
        const result = await inviteAgent(roomId, auth.member, { member_platform: 'via', member_type: 'buyer', member_ref: importedHandle }, why);
        if (!result.ok) {
          const msg = result.reason === 'already_member' ? 'They are already in the room.'
            : result.reason === 'already_invited' ? 'They already have a pending invitation.'
            : 'Could not create the invitation.';
          return NextResponse.json({ status: result.reason, message: msg }, { status: result.reason === 'error' ? 500 : 409 });
        }
        let emailedVia = false;
        const viaOwnerEmail = await resolveOwnerEmail('buyer', importedHandle);
        if (viaOwnerEmail) {
          try {
            await sendRoomInviteEmail({ to: viaOwnerEmail, roomName: room.name, inviterRef: ref, why, ctaUrl: `${APP_BASE}/backroom`, mode: 'agent', inviterCardUrl: await inviterCardUrl(auth.member) });
            emailedVia = true;
          } catch (e) { console.warn('[room/invite] imported-agent heads-up email failed:', e); }
        }
        return NextResponse.json({ status: 'invited', kind: 'buyer', invitee_ref: importedHandle, emailed: emailedVia }, { status: 201 });
      }
    }

    // A concierge is addressed by its NAME (what its Back Room handoff session
    // carries), so the invitation shows on its owner's hub. A brand by slug.
    const rrgRef = rrgKind === 'buyer' ? (identity.name?.trim() || inviteeRef) : inviteeRef;
    const result = await inviteAgent(roomId, auth.member, { member_platform: 'rrg', member_type: rrgKind, member_ref: rrgRef }, why);
    if (!result.ok) {
      const msg = result.reason === 'already_member' ? 'They are already in the room.'
        : result.reason === 'already_invited' ? 'They already have a pending invitation.'
        : 'Could not create the invitation.';
      return NextResponse.json({ status: result.reason, message: msg }, { status: result.reason === 'error' ? 500 : 409 });
    }

    let emailed = false;
    const conciergeEmail = concierge?.email ?? null;
    if (conciergeEmail) {
      try {
        await sendRoomInviteEmail({ to: conciergeEmail, roomName: room.name, inviterRef: ref, why, ctaUrl: `${APP_BASE}/backroom`, mode: 'agent', inviterCardUrl: await inviterCardUrl(auth.member) });
        emailed = true;
      } catch (e) { console.warn('[room/invite] rrg invite heads-up email failed:', e); }
    }
    return NextResponse.json({ status: 'invited', platform: 'rrg', kind: rrgKind, invitee_ref: rrgRef, name: identity.name, emailed }, { status: 201 });
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
        await sendRoomInviteEmail({ to: email, roomName: room.name, inviterRef: ref, why, ctaUrl: link, mode: 'person', inviterCardUrl: await inviterCardUrl(auth.member) });
        emailed = true;
      } catch (e) { console.warn('[room/invite] person invite email failed:', e); }
    }
    return NextResponse.json({ status: 'invited', link, emailed }, { status: 201 });
  }

  return NextResponse.json({ error: "mode must be 'agent' or 'person'" }, { status: 400 });
}
