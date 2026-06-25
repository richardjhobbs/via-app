import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import ThemeToggle from '@/components/app/ThemeToggle';

export const dynamic = 'force-dynamic';

interface ContentRow {
  id: string;
  identity: string;
  kind: number;
  content: string;
  title: string | null;
  summary: string | null;
  status: string;
  event_id: string | null;
  created_at: string;
  posted_at: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export default async function AdminNostrPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await isAdminFromCookies())) redirect('/admin/login?next=/admin/nostr');
  const { error } = await searchParams;

  const { data: pendingData } = await db
    .from('app_nostr_content')
    .select('id, identity, kind, content, title, summary, status, event_id, created_at, posted_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  const { data: recentData } = await db
    .from('app_nostr_content')
    .select('id, identity, kind, content, title, summary, status, event_id, created_at, posted_at')
    .in('status', ['posted', 'rejected'])
    .order('updated_at', { ascending: false })
    .limit(20);
  const pending = (pendingData ?? []) as ContentRow[];
  const recent = (recentData ?? []) as ContentRow[];

  return (
    <main className="min-h-dvh bg-bg text-ink px-6 py-10 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold">Nostr content approvals</h1>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link href="/admin" className="text-sm underline text-ink-2">← Admin</Link>
        </div>
      </div>

      {error === 'publish-failed' && (
        <p className="mb-6 text-sm text-danger border border-danger/40 rounded-lg px-4 py-3">
          Publish failed (identity key or relays not configured, or no relay accepted). The draft stays pending; try again.
        </p>
      )}

      <section className="mb-12">
        <h2 className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-4">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-3">No drafts awaiting approval.</p>
        ) : (
          <ul className="space-y-5">
            {pending.map((r) => (
              <li key={r.id} className="border border-line rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-xs font-mono uppercase tracking-widest text-ink-3">
                  <span className="text-accent">{r.identity}</span>
                  <span>· kind {r.kind}{r.kind === 30023 ? ' (long-form)' : ' (note)'}</span>
                  <span>· {fmt(r.created_at)}</span>
                </div>
                {r.title && <p className="font-semibold mb-1">{r.title}</p>}
                <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{r.content}</p>
                <div className="flex gap-3 mt-4">
                  <form action={`/api/admin/nostr-content/${r.id}`} method="post">
                    <input type="hidden" name="action" value="approve" />
                    <button type="submit" className="text-sm font-medium px-4 py-2 rounded-full bg-ink text-bg">Approve &amp; publish</button>
                  </form>
                  <form action={`/api/admin/nostr-content/${r.id}`} method="post">
                    <input type="hidden" name="action" value="reject" />
                    <button type="submit" className="text-sm font-medium px-4 py-2 rounded-full border border-line-strong text-ink">Reject</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-4">Recent</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing posted yet.</p>
        ) : (
          <ul className="space-y-3">
            {recent.map((r) => (
              <li key={r.id} className="text-sm text-ink-2 flex items-baseline gap-2">
                <span className={r.status === 'posted' ? 'text-live' : 'text-danger'}>{r.status}</span>
                <span className="text-ink-3 font-mono text-xs">{r.identity}</span>
                <span className="truncate">{r.title || r.content.slice(0, 80)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
