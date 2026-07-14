import { YouClient } from '@/components/backroom/YouClient';
import { sessionMembers } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';

// The You surface: your taste, in your words, editable any time. The private
// profile is never public; the card (a curated subset) goes public only when
// the member publishes it. Any of the four member kinds can hold a profile.
export default async function YouPage({ searchParams }: { searchParams: Promise<{ ref?: string; handle?: string }> }) {
  const sp = await searchParams;
  const wanted = (typeof sp.ref === 'string' ? sp.ref : typeof sp.handle === 'string' ? sp.handle : '').trim();
  const members = await sessionMembers();
  const member = (wanted ? members.find((m) => m.ref === wanted) : members[0]) ?? null;
  return <YouClient member={member} members={members} />;
}
