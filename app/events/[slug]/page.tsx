import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isGuestListProduct } from '@/lib/app/event-passes';
import { ClaimCta } from './ClaimCta';

export const dynamic = 'force-dynamic';

/**
 * Public landing page for a free-event store. Shows the event and its free pass
 * tiers, with one CTA per tier that drives the visitor to create a Buying Agent
 * (the conversion) and claim the pass (the incentive). Agents skip this entirely
 * and claim via the per-seller MCP `claim_pass` tool.
 */
export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, name, slug, headline, description, website_url, active')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller || !seller.active) notFound();

  const { data: products } = await db
    .from('app_seller_products')
    .select('id, title, description, price_minor, stock, metadata')
    .eq('seller_id', seller.id)
    .eq('active', true)
    .eq('admin_removed', false)
    .order('price_minor', { ascending: true });

  const tiers = (products ?? [])
    .filter((p) => isGuestListProduct(p.metadata))
    .map((p) => {
      const meta = p.metadata as Record<string, unknown> | null;
      const tierKey = meta && typeof meta.tier_key === 'string' ? meta.tier_key : null;
      const stock = typeof p.stock === 'number' ? p.stock : null;
      return { id: p.id as string, title: p.title as string, description: p.description as string | null, tierKey, stock };
    })
    .filter((t) => t.tierKey);

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Free event pass</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-4">{seller.name}</h1>
        {seller.headline && <p className="text-lg text-ink-1 mb-3">{seller.headline}</p>}
        {seller.description && <p className="text-ink-2 mb-10 max-w-xl">{seller.description}</p>}

        {tiers.length === 0 ? (
          <p className="text-ink-2">Passes for this event are not open yet. Check back soon.</p>
        ) : (
          <div className="space-y-5">
            {tiers.map((t) => {
              const soldOut = t.stock !== null && t.stock <= 0;
              return (
                <div key={t.id} className="border border-line-strong bg-paper p-6">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <h2 className="font-serif text-2xl">{t.title}</h2>
                    <span className="text-xs font-mono tracking-widest text-ink-3 uppercase whitespace-nowrap">Free</span>
                  </div>
                  {t.description && <p className="text-ink-2 text-sm mb-4">{t.description}</p>}
                  <div className="flex items-center justify-between gap-4">
                    <ClaimCta slug={seller.slug} tier={t.tierKey as string} label="Create your agent to claim" disabled={soldOut} />
                    {t.stock !== null && !soldOut && (
                      <span className="text-xs text-ink-3">{t.stock} place{t.stock === 1 ? '' : 's'} left</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-ink-3 mt-10 max-w-xl">
          Claiming a pass creates your free VIA Buying Agent: an AI agent that can find and buy for you across the
          network. The pass is free and there is nothing to pay. AI agents can also claim directly through this
          event&rsquo;s MCP.
        </p>
      </div>
    </section>
  );
}
