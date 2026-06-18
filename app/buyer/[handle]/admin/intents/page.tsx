import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { IntentsClient } from './IntentsClient';
import { BuyerSubHeader } from '@/components/app/BuyerSubHeader';

export const dynamic = 'force-dynamic';

interface IntentRow {
  id: string;
  intent_text: string;
  structured: Record<string, unknown>;
  status: string;
  broadcast_at: string | null;
  resolved_at: string | null;
  created_at: string;
  matchCount: number;
  discoverable: boolean;
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

  const [{ data: intents }, { data: offerIntentIds }] = await Promise.all([
    db
      .from('app_buyer_intents')
      .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at, discoverable')
      .eq('buyer_id', buyer.id as string)
      .order('created_at', { ascending: false }),
    db
      .from('app_buyer_brief_pitches')
      .select('intent_id')
      .eq('buyer_id', buyer.id as string),
  ]);
  const countByIntent = new Map<string, number>();
  for (const r of (offerIntentIds ?? []) as { intent_id: string }[]) {
    countByIntent.set(r.intent_id, (countByIntent.get(r.intent_id) ?? 0) + 1);
  }
  const intentRows: IntentRow[] = (intents ?? []).map((i) => ({
    id: i.id as string,
    intent_text: i.intent_text as string,
    structured: (i.structured ?? {}) as Record<string, unknown>,
    status: i.status as string,
    broadcast_at: (i.broadcast_at as string | null) ?? null,
    resolved_at: (i.resolved_at as string | null) ?? null,
    created_at: i.created_at as string,
    matchCount: countByIntent.get(i.id as string) ?? 0,
    discoverable: (i.discoverable as boolean | null) ?? true,
  }));

  // Summarise the buyer's active training so we can show, on the briefs page,
  // exactly what the agent applies to every brief , the difference between a
  // one-off brief and durable training, made concrete.
  const { data: memories } = await db
    .from('app_buyer_memories')
    .select('type, structured')
    .eq('buyer_id', buyer.id as string)
    .eq('active', true);

  let budget: string | null = null;
  const genres = new Set<string>();
  let condition: string | null = null;
  let delivery: string | null = null;
  for (const row of (memories ?? []) as Array<{ type: string; structured: Record<string, unknown> | null }>) {
    const s = (row.structured ?? {}) as Record<string, unknown>;
    if (row.type === 'budget' && typeof s.max_usd === 'number') {
      budget = `${s.max_usd} ${typeof s.currency === 'string' ? s.currency : 'USD'} per item`;
    }
    for (const k of ['genres', 'categories', 'brands']) {
      const v = s[k];
      if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) genres.add(x.trim());
    }
    if (typeof s.record_condition_min === 'string') condition = `${s.record_condition_min} or better`;
    if (typeof s.delivery_location === 'string') delivery = s.delivery_location;
  }
  const trainHref = `/buyer/${handle}/admin/buying-agent`;
  const hasTraining = (memories ?? []).length > 0;

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <BuyerSubHeader handle={handle} buyerId={buyer.id as string} />

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Buying intents</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            What you are looking for
          </h1>
          <p className="text-sm text-ink-2 mb-6">
            A brief is one specific thing you want right now. Your agent broadcasts it to the whole VIA
            network; sellers offer against it when they have a genuine match, and the best offers are
            ranked by your taste and preferences. Cancel a brief when you no longer want it.
          </p>

          {/* Briefs vs training , made concrete with the buyer's own preferences */}
          <div className="bg-paper border border-line rounded-lg p-5 mb-8">
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">
              Briefs vs training
            </div>
            <p className="text-sm text-ink-2">
              <strong>Briefs</strong> are what you want now. <strong>Training</strong> is how you buy
              in general: your budget, taste, conditions and where you ship. You set training once on{' '}
              <Link href={trainHref} className="underline hover:text-ink">Train your agent</Link>. Budget
              and delivery apply to every brief; taste and condition apply only where they fit what a
              brief is for.
            </p>

            {hasTraining ? (
              <div className="mt-4 space-y-4">
                {(budget || delivery) && (
                  <div>
                    <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Applies to every brief</div>
                    <ul className="space-y-1.5 text-sm text-ink">
                      {budget && (
                        <li><span className="text-ink-2">Budget:</span> {budget} <span className="text-ink-3">(affordable options ranked first; enforced when buying)</span></li>
                      )}
                      {delivery && (
                        <li><span className="text-ink-2">Ship to:</span> {delivery} <span className="text-ink-3">(checked at checkout)</span></li>
                      )}
                    </ul>
                  </div>
                )}
                {(genres.size > 0 || condition) && (
                  <div>
                    <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Applies only where it fits the brief</div>
                    <ul className="space-y-1.5 text-sm text-ink">
                      {genres.size > 0 && (
                        <li><span className="text-ink-2">Taste:</span> {Array.from(genres).join(', ')} <span className="text-ink-3">(ranks matches higher in those areas, never applied to unrelated briefs)</span></li>
                      )}
                      {condition && (
                        <li><span className="text-ink-2">Condition:</span> {condition} <span className="text-ink-3">(applied when negotiating items it makes sense for)</span></li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-3">
                You have not trained your agent yet. Without training it sources purely on the brief text.{' '}
                <Link href={trainHref} className="underline hover:text-ink">Train it</Link> to apply your budget and taste to every search.
              </p>
            )}
          </div>

          <IntentsClient
            buyerId={buyer.id as string}
            handle={handle}
            initialIntents={intentRows}
          />
        </div>
      </section>
    </main>
  );
}
