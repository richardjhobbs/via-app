import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { Wordmark } from '@/components/app/Wordmark';

export const dynamic = 'force-dynamic';

interface MemoryRow {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
}

/**
 * Read-only preferences list. The training chat is the way to add, revise,
 * or retire preferences; this surface is a snapshot of what is locked in.
 */
export default async function BuyerPreferencesPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (!user || user.id !== buyer.owner_user_id) return notFound();

  const { data: memories } = await db.rpc('app_buyer_memory_list', {
    p_handle: buyer.handle,
    p_type: null,
    p_tag: null,
    p_limit: 200,
  });
  const rows = (memories ?? []) as MemoryRow[];

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/buyer/${handle}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <Wordmark />
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/buyer/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Preferences</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            What your agent knows
          </h1>
          <p className="text-sm text-ink-2 mb-8">
            Everything your agent has locked in. To add, revise, or retire a preference, head to the{' '}
            <Link href={`/buyer/${handle}/admin/buying-agent`} className="underline hover:text-ink">
              training chat
            </Link>.
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-ink-3">
              Nothing locked in yet. Open the training chat and tell your agent how you like to buy.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((m) => (
                <li key={m.id} className="bg-paper border border-line rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-paper text-ink-3">
                      {m.type}
                    </span>
                    {Array.isArray(m.tags) && m.tags.length > 0 && (
                      <span className="text-[10px] font-mono text-ink-3">{m.tags.join(', ')}</span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-ink mb-1">{m.title}</div>
                  <div className="text-sm text-ink-2 leading-relaxed">{m.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
