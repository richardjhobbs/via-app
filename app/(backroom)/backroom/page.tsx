import { db } from '@/lib/app/db';
import { sessionMembers, type SessionMember } from '@/lib/app/backroom/ui-auth';
import { BackroomHub } from '@/components/backroom/BackroomHub';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'The Back Room · VIA' };

interface HubRoom { id: string; name: string; accent_hex: string }

async function loadMemberRooms(member: SessionMember): Promise<HubRoom[]> {
  const { data: memberships } = await db
    .from('app_room_members')
    .select('room_id')
    .eq('member_platform', member.platform)
    .eq('member_type', member.type)
    .eq('member_ref', member.ref)
    .eq('status', 'active');
  const ids = ((memberships as { room_id: string }[]) ?? []).map((m) => m.room_id);
  if (ids.length === 0) return [];
  const { data: rooms } = await db.from('app_rooms').select('id, name, accent_hex').in('id', ids).eq('status', 'active');
  return (rooms as HubRoom[]) ?? [];
}

export default async function BackroomHubPage() {
  // Reuse whatever agent session you already have: a buying agent or a seller
  // store. No separate room login.
  const members = await sessionMembers();
  const me = members[0] ?? null;
  const rooms = me ? await loadMemberRooms(me) : [];
  return <BackroomHub handle={me?.ref ?? null} memberType={me?.type ?? null} label={me?.label ?? null} rooms={rooms} />;
}
