import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { BuyerSubHeader } from '@/components/app/BuyerSubHeader';

export const dynamic = 'force-dynamic';

interface MatchRow {
  id: string;
  title: string;
  seller_name: string;
  price_usdc: number | null;
  currency: string;
  product_url: string;
  source: string | null;
  created_at: string;
}

function priceLabel(m: MatchRow): string {
  if (m.price_usdc === null) return 'price on request';
  return `${Number(m.price_usdc).toFixed(2)} ${m.currency}`;
}

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
            Price is as listed; shipping is confirmed with the seller.
            {typeof count === 'number' && <span className="text-ink-3"> {count} total{count > 200 ? ', showing the most recent 200' : ''}.</span>}
          </p>

          {matches.length === 0 ? (
            <p className="text-sm text-ink-3">
              No matches yet. <Link href={`/buyer/${handle}/admin/intents`} className="underline hover:text-ink">Add a brief</Link> to point your agent at what you want.
            </p>
          ) : (
            <div className="bg-paper border border-line rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-2.5 border-b border-line text-[10px] font-mono tracking-widest uppercase text-ink-3">
                <span>Product</span><span className="text-right">Price</span>
              </div>
              <ul>
                {matches.map((m) => (
                  <li key={m.id} className="border-b border-line last:border-b-0">
                    <a href={m.product_url} target="_blank" rel="noreferrer"
                      className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 hover:bg-background transition-colors">
                      <span className="min-w-0">
                        <span className="block text-sm text-ink break-words">{m.title}</span>
                        <span className="block text-[11px] font-mono text-ink-3 mt-0.5">
                          {m.seller_name}{m.source && m.source !== 'via' ? ` · ${m.source.toUpperCase()}` : ''}
                        </span>
                      </span>
                      <span className="text-sm tnum text-ink text-right whitespace-nowrap">{priceLabel(m)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
