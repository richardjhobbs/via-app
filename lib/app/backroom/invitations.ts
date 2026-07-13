/**
 * Room invitations: invite an existing agent, or invite a person by a tokened
 * link. Any member may invite; the invitation records the inviter so the join
 * carries the vouch. See migration 0041.
 */
import crypto from 'crypto';
import { db } from '../db';
import { joinRoom, type Author, type MemberPlatform, type MemberType } from './rooms';

export interface InviterRef { platform: MemberPlatform; type: MemberType; ref: string; }

export interface RoomInvite {
  id: string;
  room_id: string;
  room_name: string;
  inviter_ref: string;
  why: string;
  status: string;
}

/** Invite an existing VIA agent to a room. Returns the invite id or a reason. */
export async function inviteAgent(
  roomId: string,
  inviter: Author,
  invitee: Author,
  why: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'already_member' | 'already_invited' | 'error' }> {
  // Do not invite someone already an active member.
  const { data: existing } = await db
    .from('app_room_members')
    .select('id')
    .eq('room_id', roomId)
    .eq('member_platform', invitee.member_platform)
    .eq('member_type', invitee.member_type)
    .eq('member_ref', invitee.member_ref)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) return { ok: false, reason: 'already_member' };

  const { data, error } = await db
    .from('app_room_invitations')
    .insert({
      room_id: roomId,
      inviter_platform: inviter.member_platform, inviter_type: inviter.member_type, inviter_ref: inviter.member_ref,
      kind: 'agent',
      invitee_platform: invitee.member_platform, invitee_type: invitee.member_type, invitee_ref: invitee.member_ref,
      why: why.slice(0, 500),
    })
    .select('id')
    .single();
  if (error) {
    // Unique partial index => a pending invite already exists for this pair.
    if (String(error.message).includes('uq_app_room_invitations_agent_pending')) return { ok: false, reason: 'already_invited' };
    return { ok: false, reason: 'error' };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Invite a person not yet on VIA. Returns a token to build the join link. */
export async function invitePerson(
  roomId: string,
  inviter: Author,
  contact: { email?: string; name?: string },
  why: string,
): Promise<{ token: string } | null> {
  const token = crypto.randomBytes(24).toString('base64url');
  const { error } = await db
    .from('app_room_invitations')
    .insert({
      room_id: roomId,
      inviter_platform: inviter.member_platform, inviter_type: inviter.member_type, inviter_ref: inviter.member_ref,
      kind: 'person',
      invite_token: token,
      invitee_email: contact.email?.trim() || null,
      invitee_name: contact.name?.trim() || null,
      why: why.slice(0, 500),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  if (error) return null;
  return { token };
}

/** Pending agent invitations addressed to a member (their invitation inbox). */
export async function listAgentInvitesFor(platform: MemberPlatform, type: MemberType, ref: string): Promise<RoomInvite[]> {
  const { data } = await db
    .from('app_room_invitations')
    .select('id, room_id, inviter_ref, why, status, app_rooms!inner(name, status)')
    .eq('kind', 'agent')
    .eq('status', 'pending')
    .eq('invitee_platform', platform)
    .eq('invitee_type', type)
    .eq('invitee_ref', ref)
    .order('created_at', { ascending: false });
  const rows = (data as Array<Record<string, unknown>>) ?? [];
  return rows
    .filter((r) => {
      const room = Array.isArray(r.app_rooms) ? r.app_rooms[0] : r.app_rooms;
      return (room as { status?: string })?.status === 'active';
    })
    .map((r) => {
      const room = (Array.isArray(r.app_rooms) ? r.app_rooms[0] : r.app_rooms) as { name: string };
      return { id: String(r.id), room_id: String(r.room_id), room_name: room.name, inviter_ref: String(r.inviter_ref), why: String(r.why ?? ''), status: String(r.status) };
    });
}

export type RespondResult =
  | { outcome: 'joined' }
  | { outcome: 'declined' }
  | { outcome: 'full' | 'blocked' | 'not_found' };

/** A member answers an agent invitation. Accepting joins with the inviter's vouch. */
export async function respondAgentInvite(inviteId: string, member: Author, accept: boolean): Promise<RespondResult> {
  const { data } = await db
    .from('app_room_invitations')
    .select('id, room_id, inviter_ref, invitee_platform, invitee_type, invitee_ref, status')
    .eq('id', inviteId)
    .maybeSingle();
  if (!data) return { outcome: 'not_found' };
  const inv = data as Record<string, string>;
  // Only the addressed member may answer.
  if (inv.invitee_platform !== member.member_platform || inv.invitee_type !== member.member_type || inv.invitee_ref !== member.member_ref) {
    return { outcome: 'not_found' };
  }
  if (inv.status !== 'pending') return { outcome: 'not_found' };

  if (!accept) {
    await db.from('app_room_invitations').update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', inviteId);
    return { outcome: 'declined' };
  }

  const res = await joinRoom(inv.room_id, member, inv.inviter_ref, false);
  if (res.outcome === 'joined' || res.outcome === 'already') {
    await db.from('app_room_invitations').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', inviteId);
    return { outcome: 'joined' };
  }
  return { outcome: res.outcome as 'full' | 'blocked' };
}

export interface TokenInvite { room_id: string; room_name: string; inviter_ref: string; why: string; }

/** Look up a person invitation by its token (for the join page). */
export async function invitationByToken(token: string): Promise<TokenInvite | null> {
  const { data } = await db
    .from('app_room_invitations')
    .select('room_id, inviter_ref, why, status, expires_at, app_rooms!inner(name, status)')
    .eq('kind', 'person')
    .eq('invite_token', token)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  if (r.status !== 'pending') return null;
  if (r.expires_at && new Date(String(r.expires_at)) < new Date()) return null;
  const room = (Array.isArray(r.app_rooms) ? r.app_rooms[0] : r.app_rooms) as { name: string; status: string };
  if (room.status !== 'active') return null;
  return { room_id: String(r.room_id), room_name: room.name, inviter_ref: String(r.inviter_ref), why: String(r.why ?? '') };
}

/** Redeem a person invitation for a now-registered member: join and mark accepted. */
export async function redeemPersonInvite(token: string, member: Author): Promise<RespondResult> {
  const inv = await invitationByToken(token);
  if (!inv) return { outcome: 'not_found' };
  const res = await joinRoom(inv.room_id, member, inv.inviter_ref, false);
  if (res.outcome === 'joined' || res.outcome === 'already') {
    await db.from('app_room_invitations').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('invite_token', token);
    return { outcome: 'joined' };
  }
  return { outcome: res.outcome as 'full' | 'blocked' };
}
