/**
 * Back Room notifications: what is new for a member (chat + table additions by
 * others since they last opened a room), the seen-marker that clears it, and the
 * per-member email-digest preference.
 */
import { db } from '../db';
import { refPattern, type Author } from './rooms';

/** New content counts per room for a member (one round-trip via the RPC). */
export async function roomNewCountsFor(member: Author): Promise<Map<string, number>> {
  const { data, error } = await db.rpc('app_room_new_counts', {
    p_platform: member.member_platform,
    p_type: member.member_type,
    p_ref: member.member_ref,
  });
  if (error) { console.warn('[notifications] new counts failed:', error.message); return new Map(); }
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { room_id: string; n: number }[]) out.set(r.room_id, Number(r.n) || 0);
  return out;
}

/**
 * Activity by others in a member's rooms since a point in time, regardless of
 * seen-state. This drives the email digest: an active member who reads their
 * rooms daily still gets the daily summary (the seen-based counts above only
 * drive the in-app pulse).
 */
export async function roomActivityCountsFor(member: Author, sinceIso: string): Promise<Map<string, number>> {
  const { data, error } = await db.rpc('app_room_activity_counts', {
    p_platform: member.member_platform,
    p_type: member.member_type,
    p_ref: member.member_ref,
    p_since: sinceIso,
  });
  if (error) { console.warn('[notifications] activity counts failed:', error.message); return new Map(); }
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { room_id: string; n: number }[]) out.set(r.room_id, Number(r.n) || 0);
  return out;
}

/** Total new content across a member's rooms (for the banner pulse). */
export async function totalNewFor(member: Author): Promise<number> {
  let total = 0;
  for (const n of (await roomNewCountsFor(member)).values()) total += n;
  return total;
}

/** Mark a room as seen by a member (clears its pulse). Best-effort. */
export async function markRoomSeen(roomId: string, member: Author): Promise<void> {
  try {
    await db.from('app_room_members')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('member_platform', member.member_platform)
      .eq('member_type', member.member_type)
      .ilike('member_ref', refPattern(member.member_ref));
  } catch (e) { console.warn('[notifications] markRoomSeen failed:', e); }
}

export async function getEmailDigestPref(member: Author): Promise<boolean> {
  const { data } = await db.from('app_room_member_prefs')
    .select('email_digest')
    .eq('member_platform', member.member_platform)
    .eq('member_type', member.member_type)
    .eq('member_ref', member.member_ref)
    .maybeSingle();
  return (data as { email_digest: boolean } | null)?.email_digest ?? true; // default on
}

export async function setEmailDigestPref(member: Author, on: boolean): Promise<void> {
  await db.from('app_room_member_prefs').upsert({
    member_platform: member.member_platform,
    member_type: member.member_type,
    member_ref: member.member_ref,
    email_digest: on,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'member_platform,member_type,member_ref' });
}
