import { YouClient } from '@/components/backroom/YouClient';

export const dynamic = 'force-dynamic';

// The You surface: your taste, in your words, editable any time. Nothing about
// you is public. Slice one has no You surface beyond the interview and the edit.
export default async function YouPage({ searchParams }: { searchParams: Promise<{ handle?: string }> }) {
  const sp = await searchParams;
  const handle = typeof sp.handle === 'string' ? sp.handle.trim() : '';
  return <YouClient handle={handle} />;
}
