import { db } from '@/lib/app/db';
import { refPattern } from '@/lib/app/backroom/rooms';
import { sessionMembers, type SessionMember } from '@/lib/app/backroom/ui-auth';
import { roomNewCountsFor, getEmailDigestPref } from '@/lib/app/backroom/notifications';
import { BackroomHub, type HubMember, type HubRoom } from '@/components/backroom/BackroomHub';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'The Back Room · VIA' };

async function loadMemberRooms(member: SessionMember): Promise<{ id: string; name: string; accent_hex: string }[]> {
  const { data: memberships } = await db
    .from('app_room_members')
    .select('room_id')
    .eq('member_platform', member.platform)
    .eq('member_type', member.type)
    .ilike('member_ref', refPattern(member.ref))
    .eq('status', 'active');
  const ids = ((memberships as { room_id: string }[]) ?? []).map((m) => m.room_id);
  if (ids.length === 0) return [];
  const { data: rooms } = await db.from('app_rooms').select('id, name, accent_hex').in('id', ids).eq('status', 'active');
  return (rooms as { id: string; name: string; accent_hex: string }[]) ?? [];
}

export default async function BackroomHubPage() {
  // Reuse whatever agent sessions you already have: buying agents, seller
  // stores, and a federated RRG brand or concierge that arrived over the
  // handoff. No separate room login. The hub aggregates ALL of them: a session
  // holding several identities must still see every room and every invitation,
  // not just the first identity's.
  const members = await sessionMembers();

  let rooms: HubRoom[] = [];
  let emailDigest = true;
  if (members.length > 0) {
    const perMember = await Promise.all(members.map(async (m) => {
      const author = { member_platform: m.platform, member_type: m.type, member_ref: m.ref };
      const [base, counts] = await Promise.all([loadMemberRooms(m), roomNewCountsFor(author)]);
      return base.map((r) => ({ ...r, new_count: counts.get(r.id) ?? 0, handle: m.ref }));
    }));
    const seen = new Map<string, HubRoom>();
    for (const r of perMember.flat()) if (!seen.has(r.id)) seen.set(r.id, r);
    rooms = [...seen.values()];
    const first = members[0];
    emailDigest = await getEmailDigestPref({ member_platform: first.platform, member_type: first.type, member_ref: first.ref });
  }

  const hubMembers: HubMember[] = members.map((m) => ({ platform: m.platform, type: m.type, ref: m.ref, label: m.label }));
  return <BackroomHub members={hubMembers} rooms={rooms} emailDigest={emailDigest} />;
}
