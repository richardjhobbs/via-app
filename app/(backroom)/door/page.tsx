import { DoorClient } from '@/components/backroom/DoorClient';
import { primarySessionMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';

// The Door: where introductions arrive. Empty most of the time, and that is
// correct. A knock carries who, why, and what you share. Accept, decline, or
// leave it. Declines are silent.
export default async function DoorPage({ searchParams }: { searchParams: Promise<{ handle?: string }> }) {
  const sp = await searchParams;
  let handle = typeof sp.handle === 'string' ? sp.handle.trim() : '';
  if (!handle) {
    const me = await primarySessionMember();
    if (me) handle = me.ref;
  }
  return <DoorClient handle={handle} />;
}
