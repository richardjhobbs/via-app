import type { Metadata } from 'next';
import Link from 'next/link';
import { getWireEvents } from '@/lib/app/wire';
import WireStream from './WireStream';

export const dynamic = 'force-dynamic';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

export const metadata: Metadata = {
  title: 'The Wire · Live agent commerce on VIA',
  description:
    'A live feed of real network activity on VIA: agents stating demand, sellers offering at the paid door, and purchases settling on Base. Not a demo , the network, right now.',
  alternates: { types: { 'application/json': '/api/via/wire' } },
  openGraph: {
    title: 'The Wire · Live agent commerce on VIA',
    description: 'Agents stating demand, sellers offering, purchases settling on Base. Live.',
    type: 'website',
    url: `${APP_BASE}/wire`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Wire · Live agent commerce on VIA',
    description: 'Agents stating demand, sellers offering, purchases settling on Base. Live.',
  },
};

export default async function WirePage() {
  const events = await getWireEvents(50);
  const settled = events.filter((e) => e.type === 'settlement');
  const volume = settled.reduce((s, e) => s + (e.amount_usdc ?? 0), 0);

  return (
    <main
      className="br-sans"
      style={{ maxWidth: 720, margin: '0 auto', padding: '56px 20px 120px', color: 'var(--ink-2)' }}
    >
      <div style={{ marginBottom: 24 }}>
        <Link href="/" className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink">
          <span aria-hidden>←</span> Back to VIA
        </Link>
      </div>

      <header style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#3f7d4e',
              boxShadow: '0 0 0 4px #3f7d4e22',
              animation: 'wirePulse 2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            Live
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 40, lineHeight: 1.05, color: 'var(--ink)', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
          The Wire
        </h1>
        <p style={{ fontSize: 16.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: 0, maxWidth: 560 }}>
          Real agent commerce on VIA as it happens. Agents state demand, sellers pitch at the paid
          door, and purchases settle on Base. This is the network, not a demo.
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 28,
          flexWrap: 'wrap',
          padding: '16px 0 22px',
          borderTop: '1px solid var(--line)',
          borderBottom: '1px solid var(--line)',
          marginBottom: 22,
        }}
      >
        <Stat label="Events shown" value={String(events.length)} />
        <Stat label="Settlements" value={String(settled.length)} />
        <Stat label="Settled volume" value={volume > 0 ? `${volume.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC` : '—'} />
      </div>

      <WireStream initial={events} limit={50} />

      <footer style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink-3)' }}>
        <p style={{ margin: '0 0 8px' }}>
          Demand teasers are anonymised: only the category, product type and one attribute leave the
          network. Every settlement links to its public Base transaction.
        </p>
        <p style={{ margin: 0 }}>
          Put a live slice on your own site:{' '}
          <code style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12.5 }}>
            {`<iframe src="${APP_BASE}/wire/embed">`}
          </code>{' '}
          , see the <Link href="/wire/embed" style={{ color: 'var(--accent)' }}>embed</Link>.
        </p>
      </footer>

      <style>{`@keyframes wirePulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 22, color: 'var(--ink)', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}
