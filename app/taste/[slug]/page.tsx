import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublishedCardBySlug } from '@/lib/app/backroom/taste-cards';
import { TasteCard } from '@/components/backroom/TasteCard';
import { KnockButton } from '@/components/backroom/KnockButton';

export const dynamic = 'force-dynamic';

// The public taste card. Published-only; the private profile never renders
// here. No rooms, no counts, no directory: one person's declared taste, their
// agent's address, and a door to knock on.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const card = await getPublishedCardBySlug(slug);
  if (!card) return { title: 'Taste card not found · VIA' };
  const name = card.display_name || card.slug;
  const desc = card.headline || [card.references[0], card.obsessions[0]].filter(Boolean).join(', ') || `${name}'s taste card on VIA.`;
  return {
    title: `${name} · Taste card · VIA`,
    description: desc,
    alternates: { types: { 'application/json': `/api/taste/${card.slug}` } },
    openGraph: { title: `${name} · Taste card`, description: desc, type: 'profile' },
    twitter: { card: 'summary_large_image', title: `${name} · Taste card`, description: desc },
  };
}

export default async function TasteCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getPublishedCardBySlug(slug);
  if (!card) notFound();

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px 120px' }}>
      <TasteCard card={card} />

      <section style={{ marginTop: 28 }}>
        <KnockButton slug={card.slug} accent={card.accent} />
      </section>

      {(card.agent_identity.mcp_url || card.agent_identity.erc8004_agent_id) && (
        <section className="br-sans" style={{ marginTop: 32, borderTop: '1px solid var(--line)', paddingTop: 16, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <p style={{ margin: 0, letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 11 }}>Their agent</p>
          {card.agent_identity.mcp_url && (
            <p style={{ margin: '6px 0 0', wordBreak: 'break-all' }}>MCP: {card.agent_identity.mcp_url}</p>
          )}
          {card.agent_identity.erc8004_agent_id && (
            <p style={{ margin: '4px 0 0' }}>ERC-8004 #{card.agent_identity.erc8004_agent_id} on Base</p>
          )}
        </section>
      )}

      <section className="br-sans" style={{ marginTop: 40, fontSize: 14, color: 'var(--ink-2)' }}>
        <p style={{ margin: 0 }}>
          A taste card is what its owner chose to say about themselves, in their own words.{' '}
          <Link href="/backroom" style={{ color: card.accent }}>Make your own</Link>.
        </p>
      </section>
    </main>
  );
}
