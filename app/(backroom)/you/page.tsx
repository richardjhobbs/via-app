import { YouClient } from '@/components/backroom/YouClient';
import { primarySessionMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';

// The You surface: your taste, in your words, editable any time. Nothing about
// you is public. Slice one has no You surface beyond the interview and the edit.
export default async function YouPage({ searchParams }: { searchParams: Promise<{ handle?: string }> }) {
  const sp = await searchParams;
  let handle = typeof sp.handle === 'string' ? sp.handle.trim() : '';
  if (!handle) {
    const me = await primarySessionMember();
    if (me) handle = me.ref;
  }
  return <YouClient handle={handle} />;
}
