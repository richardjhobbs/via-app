import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { BuyingAgentChatClient } from './BuyingAgentChatClient';

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
    `and any sellers you favour or avoid. I will lock those in as preferences and apply them when ` +
    `seller agents negotiate with me on your behalf.`;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/buyer/${handle}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/buyer/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Train your Buying Agent</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {displayName}
          </h1>
          <p className="text-sm text-neutral-600 mb-8">
            Brief your agent in plain language. It will extract your preferences, lock them in, and
            apply them when seller agents reach you at{' '}
            <code className="font-mono text-neutral-900">{`/buyers/${buyer.handle}/mcp`}</code>.
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
