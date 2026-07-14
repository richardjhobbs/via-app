import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getStoreCardBySlug } from '@/lib/app/backroom/store-card';

export const dynamic = 'force-dynamic';

// The public marketing card for a room-graduated store: the co-created product,
// its price, the co-creators with verifiable identity, and how to buy. The paid
// deliverable is never exposed here; buying happens at the seller x402 door.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const card = await getStoreCardBySlug(slug);
  if (!card) return { title: 'Store not found · VIA' };
  const p = card.products[0];
  const desc = p ? `${p.title}, ${p.price_usd} USDC. Made by ${p.cocreators.map((c) => c.name).join(' and ')} on VIA.` : (card.headline ?? card.store_name);
  return {
    title: `${card.store_name} · VIA`,
    description: desc,
    alternates: { types: { 'application/json': `/api/store/${card.slug}` } },
    openGraph: { title: card.store_name, description: desc, type: 'website' },
    twitter: { card: 'summary_large_image', title: card.store_name, description: desc },
  };
}

export default async function StoreCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getStoreCardBySlug(slug);
  if (!card) notFound();

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px 120px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
        <span className="br-sans" style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Made together on VIA</span>
        <span className="br-sans" style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>VIA</span>
      </div>
      <h1 className="br-serif" style={{ fontSize: 34, fontWeight: 400, margin: 0, lineHeight: 1.1, color: 'var(--ink)' }}>{card.store_name}</h1>
      {card.headline && <p className="br-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--ink-2)', margin: '10px 0 0' }}>{card.headline}</p>}
      {card.status === 'pending' && (
        <p className="br-sans" style={{ fontSize: 13, color: 'var(--warning)', margin: '12px 0 0' }}>Pending VIA approval. It goes on sale once reviewed.</p>
      )}

      {card.products.map((p) => (
        <article key={p.id} style={{ marginTop: 28, borderTop: '1px solid var(--line)', paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <h2 className="br-serif" style={{ fontSize: 26, fontWeight: 400, margin: 0, color: 'var(--ink)' }}>{p.title}</h2>
            <span className="br-serif" style={{ fontSize: 22, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{p.price_usd} USDC</span>
          </div>
          {p.description && <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55, margin: '10px 0 0' }}>{p.description}</p>}

          <div style={{ marginTop: 18 }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>Made by</p>
            {p.cocreators.map((c) => (
              <div key={c.ref} className="br-sans" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 14 }}>
                <span style={{ color: 'var(--ink)' }}>
                  {c.card_slug ? <a href={`/taste/${c.card_slug}`} style={{ color: 'inherit' }}>{c.name}</a> : c.name}
                  <span style={{ color: 'var(--ink-3)' }}> · {c.pct}%</span>
                </span>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                  {c.erc8004_agent_id ? `ERC-8004 #${c.erc8004_agent_id}` : ''}
                </span>
              </div>
            ))}
          </div>

          {p.disclaimer && (
            <p className="br-sans" style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '16px 0 0', lineHeight: 1.5 }}>{p.disclaimer}</p>
          )}

          <div style={{ marginTop: 18 }}>
            <p className="br-sans" style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>
              {p.buyable
                ? 'Buy with your agent: point it at the store MCP and call buy_product. Settles in USDC over the x402 door; the split pays each maker automatically.'
                : 'Not yet on sale. Come back once VIA has approved the store.'}
            </p>
            <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '8px 0 0', wordBreak: 'break-all' }}>MCP: {card.seller_mcp_url}</p>
          </div>
        </article>
      ))}

      <section className="br-sans" style={{ marginTop: 40, borderTop: '1px solid var(--line)', paddingTop: 20, fontSize: 14, color: 'var(--ink-2)' }}>
        <p style={{ margin: 0 }}>
          Made in a VIA back room by people who met through taste.{' '}
          <Link href="/taste" style={{ color: 'var(--accent)' }}>Make your own card</Link> and find yours.
        </p>
      </section>
    </main>
  );
}
