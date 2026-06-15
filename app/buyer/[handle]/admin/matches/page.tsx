import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { BuyerSubHeader } from '@/components/app/BuyerSubHeader';
import { MatchesClient, type MatchRow } from './MatchesClient';

export const dynamic = 'force-dynamic';

export default async function BuyerMatchesPage({
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

  const buyerId = buyer.id as string;
  const { data, count } = await db
    .from('app_buyer_intent_matches')
    .select('id, title, seller_name, price_usdc, currency, product_url, source, created_at', { count: 'exact' })
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false })
    .limit(200);
  const matches = (data ?? []) as MatchRow[];

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <BuyerSubHeader handle={handle} buyerId={buyerId} />

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Matches</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            Everything your agent found
          </h1>
          <p className="text-sm text-ink-2 mb-6">
            Every product matched to your briefs across the VIA network, newest first.
            Price is as listed; shipping is confirmed with the seller. VIA-network items can be
            bought by your agent here: it settles in USDC on-chain, you only confirm.
            {typeof count === 'number' && <span className="text-ink-3"> {count} total{count > 200 ? ', showing the most recent 200' : ''}.</span>}
          </p>

          <MatchesClient buyerId={buyerId} handle={handle} matches={matches} />
        </div>
      </section>
    </main>
  );
}
