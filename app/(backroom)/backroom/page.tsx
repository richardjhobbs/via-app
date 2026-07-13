import { db } from '@/lib/app/db';
import { getBuyerUser, getUserBuyers } from '@/lib/app/buyer-auth';
import { BackroomHub } from '@/components/backroom/BackroomHub';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'The Back Room · VIA' };

interface HubRoom { id: string; name: string; accent_hex: string }

async function loadMemberRooms(handle: string): Promise<HubRoom[]> {
  const { data: memberships } = await db
    .from('app_room_members')
    .select('room_id')
    .eq('member_platform', 'via')
    .eq('member_type', 'buyer')
    .eq('member_ref', handle);
  const ids = ((memberships as { room_id: string }[]) ?? []).map((m) => m.room_id);
  if (ids.length === 0) return [];
  const { data: rooms } = await db.from('app_rooms').select('id, name, accent_hex').in('id', ids);
  return (rooms as HubRoom[]) ?? [];
}

export default async function BackroomHubPage() {
  const user = await getBuyerUser();
  let handle: string | null = null;
  let rooms: HubRoom[] = [];
  if (user) {
    const buyers = await getUserBuyers(user.id);
    handle = buyers[0]?.handle ?? null;
    if (handle) rooms = await loadMemberRooms(handle);
  }
  return <BackroomHub handle={handle} rooms={rooms} />;
}
