import type { Metadata } from 'next';
import { getWireEvents } from '@/lib/app/wire';
import WireStream from '../WireStream';

export const dynamic = 'force-dynamic';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

export const metadata: Metadata = {
  title: 'The Wire · VIA',
  robots: { index: false },
};

/**
 * The embeddable ticker , brands drop this into an <iframe> on their own site.
 * Deliberately chromeless and transparent so it inherits the host's background;
 * frame-ancestors is opened for this route in next.config.ts.
 */
export default async function WireEmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const { limit: limitParam } = await searchParams;
  const limit = Math.min(Math.max(Number(limitParam) || 20, 5), 50);
  const events = await getWireEvents(limit);

  return (
    <main
      className="br-sans"
      style={{ maxWidth: 560, margin: '0 auto', padding: '14px 16px 18px', color: 'var(--ink-2)', background: 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3f7d4e', animation: 'wirePulse 2s ease-in-out infinite' }} />
          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            The Wire · Live
          </span>
        </div>
        <a
          href={`${APP_BASE}/wire`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          VIA ↗
        </a>
      </div>
      <WireStream initial={events} limit={limit} compact />
      <style>{`@keyframes wirePulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
    </main>
  );
}
