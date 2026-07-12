import { RoomClient } from '@/components/backroom/RoomClient';

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
  const handle = typeof sp.handle === 'string' ? sp.handle.trim() : '';
  return <RoomClient roomId={roomId} handle={handle} />;
}
