import { RoomClient } from '@/components/backroom/RoomClient';
import { isAdminFromCookies } from '@/lib/app/auth';
import { primarySessionMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';

// One room at a time, full screen. The table is the primary surface; talk is
// ambient, the objects hold the room's memory.
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ handle?: string }>;
}) {
  const { roomId } = await params;
  const sp = await searchParams;
  // Use the handle in the URL if given, otherwise the identity you are already
  // signed in as (buyer or seller). No separate room login.
  let handle = typeof sp.handle === 'string' ? sp.handle.trim() : '';
  if (!handle) {
    const me = await primarySessionMember();
    if (me) handle = me.ref;
  }
  const isAdmin = !handle && (await isAdminFromCookies());
  return <RoomClient roomId={roomId} handle={handle} isAdmin={isAdmin} />;
}
