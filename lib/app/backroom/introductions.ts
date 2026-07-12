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

export type MemberPlatform = 'via' | 'rrg';
export type MemberType = 'buyer' | 'seller';
export type IntroStatus = 'proposed' | 'accepted' | 'declined' | 'connected';

export interface Party { member_platform: MemberPlatform; member_type: MemberType; member_ref: string; }

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
  | { outcome: 'connected' }
  | { outcome: 'not_found' };

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

  const otherAccepted = a ? row.b_accepted : row.a_accepted;
  if (otherAccepted === true) {
    await db
      .from('app_introductions')
      .update({
        [a ? 'a_accepted' : 'b_accepted']: true,
        status: 'connected',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', introId);
    return { outcome: 'connected' };
  }

  await db
    .from('app_introductions')
    .update({ [a ? 'a_accepted' : 'b_accepted']: true, status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', introId);
  return { outcome: 'accepted_waiting' };
}
