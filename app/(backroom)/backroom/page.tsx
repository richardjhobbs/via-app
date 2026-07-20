import { db } from '@/lib/app/db';
import { refPattern } from '@/lib/app/backroom/rooms';
import { sessionMembers, type SessionMember } from '@/lib/app/backroom/ui-auth';
import { roomNewCountsFor, getEmailDigestPref } from '@/lib/app/backroom/notifications';
import { BackroomHub } from '@/components/backroom/BackroomHub';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'The Back Room · VIA' };

interface HubRoom { id: string; name: string; accent_hex: string; new_count: number }

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
  // Reuse whatever agent session you already have: a buying agent or a seller
  // store. No separate room login.
  const members = await sessionMembers();
  const me = members[0] ?? null;

  let rooms: HubRoom[] = [];
  let emailDigest = true;
  if (me) {
    const author = { member_platform: me.platform, member_type: me.type, member_ref: me.ref };
    const [base, counts, pref] = await Promise.all([
      loadMemberRooms(me),
      roomNewCountsFor(author),
      getEmailDigestPref(author),
    ]);
    rooms = base.map((r) => ({ ...r, new_count: counts.get(r.id) ?? 0 }));
    emailDigest = pref;
  }

  return <BackroomHub handle={me?.ref ?? null} platform={me?.platform ?? null} memberType={me?.type ?? null} label={me?.label ?? null} rooms={rooms} emailDigest={emailDigest} />;
}
