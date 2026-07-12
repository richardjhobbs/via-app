import { DoorClient } from '@/components/backroom/DoorClient';

export const dynamic = 'force-dynamic';

// The Door: where introductions arrive. Empty most of the time, and that is
// correct. A knock carries who, why, and what you share. Accept, decline, or
// leave it. Declines are silent.
export default async function DoorPage({ searchParams }: { searchParams: Promise<{ handle?: string }> }) {
  const sp = await searchParams;
  const handle = typeof sp.handle === 'string' ? sp.handle.trim() : '';
  return <DoorClient handle={handle} />;
}
