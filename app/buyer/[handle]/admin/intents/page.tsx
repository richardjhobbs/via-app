import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { IntentsClient } from './IntentsClient';
import { Wordmark } from '@/components/app/Wordmark';

export const dynamic = 'force-dynamic';

interface IntentRow {
  id: string;
  intent_text: string;
  structured: Record<string, unknown>;
  status: string;
  broadcast_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export default async function BuyerIntentsPage({
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

  const { data: intents } = await db
    .from('app_buyer_intents')
    .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at')
    .eq('buyer_id', buyer.id as string)
    .order('created_at', { ascending: false });

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
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Buying intents</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            What you are looking for
          </h1>
          <p className="text-sm text-ink-2 mb-8">
            Open intents tell your agent what to pursue right now. Cancel one when you no longer want it.
          </p>

          <IntentsClient
            buyerId={buyer.id as string}
            initialIntents={(intents ?? []) as IntentRow[]}
          />
        </div>
      </section>
    </main>
  );
}
