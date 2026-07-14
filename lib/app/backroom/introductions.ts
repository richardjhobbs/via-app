/**
 * Back Room introductions (roadmap Phase C).
 *
 * A warm, double-opt-in human introduction. For the seed room the pairs are
 * curated by hand (an admin action); the taste matcher plugs into the same
 * state machine later. Each side responds independently:
 *
 *   proposed  , offered, neither side has accepted
 *   accepted  , one side accepted, waiting on the other
 *   declined  , one side declined. SILENT: no notification, the other side is
 *               never told, nothing is scored against anyone
 *   connected , both accepted; a room can now form
 *
 * The last AI artifact is the context pack shown at the Door. After the
 * introduction, no agent drafts anything (the no-AI-past-the-introduction
 * invariant); this module only moves the state, it never writes conversation.
 *
 * A party is any of the four member kinds across two platforms, identified by
 * (platform, kind, ref).
 */
import { db } from '../db';
import { createRoom, joinRoom, RoomNameTakenError, type Author } from './rooms';
import { getCardForMember } from './taste-cards';

export type MemberPlatform = 'via' | 'rrg';
export type MemberType = 'buyer' | 'seller';
export type IntroStatus = 'proposed' | 'accepted' | 'declined' | 'connected';

export interface Party { member_platform: MemberPlatform; member_type: MemberType; member_ref: string; }

// ── Connection -> room ───────────────────────────────────────────────
// When two members connect, a room forms and seats them both. This is the
// roadmap's exit from the introduction: agents matched, humans accepted, now
// they have a private place to make something. Best-effort: a failure here
// must not undo the connection, so callers log and carry on.

async function partyName(p: Party): Promise<string> {
  const card = await getCardForMember(p.member_platform, p.member_type, p.member_ref);
  return (card?.display_name || p.member_ref).trim();
}

// A federated (RRG) member has no locally-resolvable wallet; take it from the
// wallet snapshot on their published card. VIA members resolve in joinRoom.
async function partyWallet(p: Party): Promise<string | null> {
  if (p.member_platform !== 'rrg') return null;
  const card = await getCardForMember(p.member_platform, p.member_type, p.member_ref);
  return card?.agent_identity.agent_wallet ?? null;
}

/**
 * Form the room for a freshly connected pair and seat both as founders. Returns
 * the new room id, or null if room creation failed (the connection still holds).
 */
export async function createRoomForConnection(a: Party, b: Party): Promise<string | null> {
  try {
    const [an, bn, aw, bw] = await Promise.all([partyName(a), partyName(b), partyWallet(a), partyWallet(b)]);
    const base = `${an} and ${bn}`.slice(0, 56);
    let room = null;
    for (let n = 0; n < 6 && !room; n++) {
      const name = n === 0 ? base : `${base} ${n + 1}`.slice(0, 60);
      try { room = await createRoom({ name, created_from: 'introduction', createdBy: a as Author }); }
      catch (e) { if (!(e instanceof RoomNameTakenError)) throw e; }
    }
    if (!room) return null;
    await joinRoom(room.id, a as Author, null, true, aw);
    await joinRoom(room.id, b as Author, a.member_ref, true, bw);
    return room.id;
  } catch (e) {
    console.warn(`[introductions] room-from-connection failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export interface IntroductionRow {
  id: string;
  a_platform: MemberPlatform; a_type: MemberType; a_ref: string;
  b_platform: MemberPlatform; b_type: MemberType; b_ref: string;
  a_accepted: boolean | null;
  b_accepted: boolean | null;
  status: IntroStatus;
  context_pack: Record<string, unknown>;
}

export interface Knock {
  id: string;
  other: Party;
  context_pack: Record<string, unknown>;
  status: IntroStatus;
}

export type ProposeResult =
  | { outcome: 'proposed'; id: string }
  | { outcome: 'exists'; id: string };

export async function proposeIntroduction(a: Party, b: Party, contextPack: Record<string, unknown>): Promise<ProposeResult> {
  // Order-independent: check both directions before inserting so a curator
  // cannot double-propose the same two people.
  const matchA = `and(a_platform.eq.${a.member_platform},a_ref.eq.${a.member_ref},b_platform.eq.${b.member_platform},b_ref.eq.${b.member_ref})`;
  const matchB = `and(a_platform.eq.${b.member_platform},a_ref.eq.${b.member_ref},b_platform.eq.${a.member_platform},b_ref.eq.${a.member_ref})`;
  const { data: existing } = await db
    .from('app_introductions')
    .select('id')
    .or(`${matchA},${matchB}`)
    .maybeSingle();
  if (existing) return { outcome: 'exists', id: (existing as { id: string }).id };

  const { data, error } = await db
    .from('app_introductions')
    .insert({
      a_platform: a.member_platform, a_type: a.member_type, a_ref: a.member_ref,
      b_platform: b.member_platform, b_type: b.member_type, b_ref: b.member_ref,
      context_pack: contextPack,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { outcome: 'proposed', id: (data as { id: string }).id };
}

function isSideA(row: IntroductionRow, platform: MemberPlatform, ref: string): boolean {
  return row.a_platform === platform && row.a_ref === ref;
}
function isSideB(row: IntroductionRow, platform: MemberPlatform, ref: string): boolean {
  return row.b_platform === platform && row.b_ref === ref;
}

/** The knocks waiting at a member's Door: proposed to them and not yet answered. */
export async function listKnocksForMember(platform: MemberPlatform, ref: string): Promise<Knock[]> {
  const { data } = await db
    .from('app_introductions')
    .select('id, a_platform, a_type, a_ref, b_platform, b_type, b_ref, a_accepted, b_accepted, status, context_pack')
    .or(`and(a_platform.eq.${platform},a_ref.eq.${ref}),and(b_platform.eq.${platform},b_ref.eq.${ref})`)
    .in('status', ['proposed', 'accepted'])
    .order('created_at', { ascending: false });
  const rows = (data as IntroductionRow[]) ?? [];
  return rows
    .filter((r) => {
      const a = isSideA(r, platform, ref);
      const mine = a ? r.a_accepted : r.b_accepted;
      return mine == null;
    })
    .map((r) => {
      const a = isSideA(r, platform, ref);
      return {
        id: r.id,
        other: a
          ? { member_platform: r.b_platform, member_type: r.b_type, member_ref: r.b_ref }
          : { member_platform: r.a_platform, member_type: r.a_type, member_ref: r.a_ref },
        context_pack: r.context_pack ?? {},
        status: r.status,
      };
    });
}

export type RespondResult =
  | { outcome: 'declined' }
  | { outcome: 'accepted_waiting' }
  | { outcome: 'connected'; room_id: string | null }
  | { outcome: 'not_found' };

/** Mark one side connected: flip both accepted, set status, form the room. */
async function connect(row: IntroductionRow, meIsA: boolean): Promise<{ outcome: 'connected'; room_id: string | null }> {
  await db
    .from('app_introductions')
    .update({
      [meIsA ? 'a_accepted' : 'b_accepted']: true,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  const a: Party = { member_platform: row.a_platform, member_type: row.a_type, member_ref: row.a_ref };
  const b: Party = { member_platform: row.b_platform, member_type: row.b_type, member_ref: row.b_ref };
  const roomId = await createRoomForConnection(a, b);
  await db.from('app_introductions').update({ room_id: roomId }).eq('id', row.id);
  return { outcome: 'connected', room_id: roomId };
}

/** A member answers a knock. Accepting is one of the three deliberate taps. */
export async function respondToKnock(introId: string, platform: MemberPlatform, ref: string, accept: boolean): Promise<RespondResult> {
  const { data } = await db
    .from('app_introductions')
    .select('id, a_platform, a_type, a_ref, b_platform, b_type, b_ref, a_accepted, b_accepted, status')
    .eq('id', introId)
    .maybeSingle();
  if (!data) return { outcome: 'not_found' };
  const row = data as IntroductionRow;
  const a = isSideA(row, platform, ref);
  const b = isSideB(row, platform, ref);
  if (!a && !b) return { outcome: 'not_found' };

  if (!accept) {
    await db
      .from('app_introductions')
      .update({ [a ? 'a_accepted' : 'b_accepted']: false, status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', introId);
    return { outcome: 'declined' };
  }

  // The other side has already opted in (a knock pre-accepts the knocker, or a
  // matcher intro whose counterpart accepted first): accepting connects, and a
  // room forms.
  const otherAccepted = a ? row.b_accepted : row.a_accepted;
  if (otherAccepted === true) return connect(row, a);

  await db
    .from('app_introductions')
    .update({ [a ? 'a_accepted' : 'b_accepted']: true, status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', introId);
  return { outcome: 'accepted_waiting' };
}

export type KnockResult =
  | { outcome: 'knocked' }
  | { outcome: 'connected'; room_id: string | null };

/**
 * A member knocks on another's card: this IS the knocker's opt-in. If no
 * introduction exists yet, one is created with the knocker already accepted, so
 * the recipient accepting alone connects them. If an introduction already
 * exists (e.g. the matcher proposed this pair), the knock records the knocker's
 * acceptance on their side, connecting immediately when the other side had
 * already accepted. Order-independent on the pair, like proposeIntroduction.
 */
export async function registerKnock(knocker: Party, target: Party, contextPack: Record<string, unknown>): Promise<KnockResult> {
  const matchA = `and(a_platform.eq.${knocker.member_platform},a_ref.eq.${knocker.member_ref},b_platform.eq.${target.member_platform},b_ref.eq.${target.member_ref})`;
  const matchB = `and(a_platform.eq.${target.member_platform},a_ref.eq.${target.member_ref},b_platform.eq.${knocker.member_platform},b_ref.eq.${knocker.member_ref})`;
  const { data: existing } = await db
    .from('app_introductions')
    .select('id, a_platform, a_type, a_ref, b_platform, b_type, b_ref, a_accepted, b_accepted, status')
    .or(`${matchA},${matchB}`)
    .maybeSingle();

  if (!existing) {
    await db
      .from('app_introductions')
      .insert({
        a_platform: knocker.member_platform, a_type: knocker.member_type, a_ref: knocker.member_ref,
        b_platform: target.member_platform, b_type: target.member_type, b_ref: target.member_ref,
        a_accepted: true,        // the knock is the knocker's acceptance
        status: 'accepted',      // waiting on the recipient at their Door
        context_pack: contextPack,
      });
    return { outcome: 'knocked' };
  }

  const row = existing as IntroductionRow;
  const knockerIsA = row.a_platform === knocker.member_platform && row.a_ref === knocker.member_ref;
  const otherAccepted = knockerIsA ? row.b_accepted : row.a_accepted;
  if (otherAccepted === true) return connect(row, knockerIsA);

  await db
    .from('app_introductions')
    .update({ [knockerIsA ? 'a_accepted' : 'b_accepted']: true, status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', row.id);
  return { outcome: 'knocked' };
}
