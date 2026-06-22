import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { getBalance, getCreditHistory, usdToCredits } from '@/lib/app/buyer-credits';
import { CreditsClient, type CreditTx } from './CreditsClient';
import { ByoKeyCard } from './ByoKeyCard';
import { BuyerSubHeader } from '@/components/app/BuyerSubHeader';

export const dynamic = 'force-dynamic';

/**
 * Credits surface. Shows the buyer's balance and lets the owner top up by card
 * or by sending USDC to their in-app wallet, then converting it to credits with
 * a gasless permit (POST /api/buyer/[buyerId]/credits/topup). No tx hashes.
 */
export default async function BuyerCreditsPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, wallet_address, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (!user || user.id !== buyer.owner_user_id) return notFound();

  const buyerId = buyer.id as string;
  const [balance, history, byoRow] = await Promise.all([
    getBalance(buyerId),
    getCreditHistory(buyerId, 20),
    db.from('app_buyers').select('llm_byo_provider, llm_byo_key_last4, llm_byo_model').eq('id', buyerId).maybeSingle(),
  ]);
  const byo = {
    connected: !!byoRow.data?.llm_byo_provider,
    provider:  (byoRow.data?.llm_byo_provider as string | null) ?? null,
    last4:     (byoRow.data?.llm_byo_key_last4 as string | null) ?? null,
    model:     (byoRow.data?.llm_byo_model as string | null) ?? null,
  };

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <BuyerSubHeader handle={handle} buyerId={buyerId} />

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Credits</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            Agent credits
          </h1>
          <p className="text-sm text-ink-2 mb-8">
            Credits fund your Buying Agent&rsquo;s work , the conversations it has while training and
            the negotiations it runs on your behalf. New agents start with 1,000 free credits
            (about 1 USD). Top up by card or USDC, no gas and no transaction hashes.
          </p>

          <CreditsClient
            buyerId={buyerId}
            initialCredits={usdToCredits(balance)}
            initialHistory={history as CreditTx[]}
          />

          <div className="mt-10">
            <ByoKeyCard buyerId={buyerId} initial={byo} />
          </div>
        </div>
      </section>
    </main>
  );
}
