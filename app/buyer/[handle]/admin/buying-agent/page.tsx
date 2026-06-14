import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { BuyingAgentChatClient } from './BuyingAgentChatClient';
import { BuyerSubHeader } from '@/components/app/BuyerSubHeader';

export const dynamic = 'force-dynamic';

/**
 * Buying Agent training chat. The owner briefs their own DeepSeek-backed
 * agent here; the agent stores extracted preferences in app_buyer_memories,
 * which the per-buyer MCP at /buyers/[handle]/mcp reads back when seller
 * agents call get_buyer_preferences or negotiate.
 */
export default async function BuyerBuyingAgentPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();

  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (!user || user.id !== buyer.owner_user_id) return notFound();

  const displayName = (buyer.display_name as string | null) ?? (buyer.handle as string);
  const seedGreeting =
    `I am your Buying Agent, @${buyer.handle}.\n\n` +
    `Tell me how you like to buy: the qualities you want, the things you will not touch, your budget, ` +
    `and any sellers you favour or avoid. I will learn these as your training and apply them to every ` +
    `brief , ranking what I find by your taste , and when seller agents negotiate with me on your behalf.\n\n` +
    `Or just tell me to find something specific now and I will start a brief and search the whole network for it.`;

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <BuyerSubHeader handle={handle} buyerId={buyer.id as string} />

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Train your Buying Agent</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {displayName}
          </h1>
          <p className="text-sm text-ink-2 mb-8">
            This is your <strong>training</strong> , how you buy in general: your taste, budget,
            conditions, and sellers you favour or avoid. Tell the agent in plain language and it locks
            these in. Training shapes everything your agent does: it learns your taste to rank the
            products your briefs surface, and guides how it negotiates with sellers at{' '}
            <code className="font-mono text-ink">{`/buyers/${buyer.handle}/mcp`}</code>. To pursue one
            specific item now, just ask the agent to find it and it will start a{' '}
            <Link href={`/buyer/${handle}/admin/intents`} className="underline hover:text-ink">brief</Link> and search for it.
          </p>

          <BuyingAgentChatClient
            buyerId={buyer.id as string}
            handle={buyer.handle as string}
            displayName={displayName}
            seedGreeting={seedGreeting}
          />
        </div>
      </section>
    </main>
  );
}
