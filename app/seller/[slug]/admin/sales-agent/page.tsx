import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';
import { SalesAgentChatClient } from './SalesAgentChatClient';

export const dynamic = 'force-dynamic';

/**
 * Sales Agent training chat. The seller talks to their own DeepSeek-backed
 * agent here; the agent stores extracted facts in app_seller_memories,
 * which the per-seller MCP at /sellers/[slug]/mcp reads back when buyers
 * (or buying agents) call ask_sales_agent.
 */
export default async function SellerSalesAgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, description, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin/sales-agent`)}`);
  }
  if (user.id !== seller.owner_user_id) return notFound();

  const seedGreeting =
    `You are set up. I am the Sales Agent for ${seller.name}.\n\n` +
    `${seller.description ? `Your one-liner says: "${seller.description}". ` : ''}` +
    `Tell me what you sell or offer, who it is for, and what makes it worth a buyer's attention. ` +
    `I will lock in the facts as memories so buying agents reaching the /sellers/${seller.slug}/mcp endpoint can ask me about you and get accurate answers.`;

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/seller/${slug}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <span className="wordmark text-ink">VIA</span>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/seller/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Train your Sales Agent</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {seller.name}
          </h1>
          <p className="text-sm text-ink-2 mb-8">
            Brief your agent in plain language. It will extract structured facts, lock them in
            as memories, and read them back to buying agents at{' '}
            <code className="font-mono text-ink">{`/sellers/${seller.slug}/mcp`}</code>.
          </p>

          <SalesAgentChatClient
            sellerId={seller.id as string}
            sellerName={seller.name as string}
            sellerSlug={seller.slug as string}
            seedGreeting={seedGreeting}
          />
        </div>
      </section>
    </main>
  );
}
