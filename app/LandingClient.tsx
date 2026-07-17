'use client';

import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { Wordmark } from '@/components/app/Wordmark';
import TestAgentBadge from '@/components/app/TestAgentBadge';
import WireStream from './wire/WireStream';
import type { NetworkMetrics } from '@/lib/app/network-stats';
import type { WireEvent } from '@/lib/app/wire';

/* ──────────────────────────────────────────────────────────────────────────
   Landing "The Seam", Maison design. Sellers left, buyers right, one live deal
   negotiating across the divide. Marquee and stat readouts are design seed.
   ────────────────────────────────────────────────────────────────────────── */

const MARQUEE = [
  'AGENT MATCHED', 'WHOLESALE LOAVES · 240 USDC', 'SETTLED IN USDC',
  'KYOTO RYOKAN · BOOKED', 'SECURITY AUDIT · NEGOTIATING', 'NEGOTIATING · 4 OPEN',
  'NO ADS · NO ALGORITHM', 'COACHING BLOCK · 540 USDC', 'TRADEMARK FILING · RETAINED',
];

function LiveDot() {
  return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--live)', animation: 'via-pulse 2s infinite' }} />;
}

function Section({ n, label, align = 'left' }: { n: string; label: string; align?: 'left' | 'right' }) {
  return (
    <div className="uc-mono" style={{ display: 'flex', alignItems: 'baseline', gap: 10, color: 'var(--ink-3)', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span style={{ color: 'var(--accent)' }}>§&nbsp;{n}</span>
      <span>{label}</span>
    </div>
  );
}

function Marquee() {
  const row = (
    <span style={{ display: 'inline-block' }}>
      {MARQUEE.map((m, i) => (
        <span key={i} style={{ margin: '0 30px' }}>
          <span style={{ color: 'var(--accent)', marginRight: 30 }}>●</span>{m}
        </span>
      ))}
    </span>
  );
  return (
    <div style={{ borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.16em',
      textTransform: 'uppercase', color: 'var(--ink-3)', padding: '9px 0', overflow: 'hidden', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'inline-block', animation: 'via-marquee 48s linear infinite' }}>{row}{row}</div>
    </div>
  );
}

/** The middle seam panel: the live network feed off The Wire, newest first,
 *  scrollable, capped at the 50 most recent events. Server-seeded then polled. */
function WireSeam({ initial }: { initial: WireEvent[] }) {
  return (
    <div className="seam-deal">
      <div className="deal-head">
        <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <LiveDot /> LIVE · <span style={{ color: 'var(--ink-2)' }}>THE WIRE</span>
        </div>
        <Link href="/wire" className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textDecoration: 'none' }}>
          OPEN <span aria-hidden>↗</span>
        </Link>
      </div>
      <div className="wire-thread">
        <WireStream initial={initial} limit={50} compact />
      </div>
    </div>
  );
}

export default function LandingClient({ metrics, wire }: { metrics: NetworkMetrics; wire: WireEvent[] }) {
  const stats: [string, string, string][] = [
    ['LIVE SELLERS', metrics.sellers.toLocaleString(), 'across the network'],
    ['LIVE BUYING AGENTS', metrics.buyingAgents.toLocaleString(), 'trained and active'],
    ['PRODUCTS AVAILABLE', metrics.products.toLocaleString(), 'agent-purchasable'],
  ];
  return (
    <div className="via-page">
      <header className="via-top">
        <div className="via-top-inner">
          <a className="uc-mono via-top-link" href="https://getvia.xyz" style={{ fontSize: 10, color: 'var(--ink-3)' }}>getvia.xyz ↗</a>
          <Link href="/" aria-label="VIA home" style={{ display: 'inline-flex', justifyContent: 'center' }}><Wordmark /></Link>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'flex-end' }}>
            <Link href="/faq" className="via-faq-link">FAQ</Link>
            <Link href="/seller/login" className="via-top-link" style={{ fontSize: 13, color: 'var(--ink-2)', textDecoration: 'none' }}>Seller sign in →</Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <Marquee />

      <div className="via-hero">
        <div className="uc-mono" style={{ color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--accent)' }} /> PICK A PATH
        </div>
        <h1 className="via-h1">
          Sales Agent <em style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--accent)' }}>or</em> Buying Agent.
        </h1>
        <p className="via-hero-sub">
          Onboard your store, your service or a single product and meet a Sales Agent that pitches on your behalf. Or train a Buying Agent that finds, negotiates and books for you.
        </p>
      </div>

      <div className="via-seam">
        <section className="seam-side seam-seller">
          <div>
            <Section n="01" label="FOR SELLERS" />
            <p className="seam-copy">Register your business, sync or list your offer, and meet a Sales Agent that pitches to buying agents on your behalf.</p>
          </div>
          <div className="seam-foot">
            <Link href="/onboard?role=seller" className="btn">Onboard <span className="arrow" aria-hidden>→</span></Link>
            <div className="uc-mono seam-note">Settles in USDC</div>
          </div>
        </section>

        <WireSeam initial={wire} />

        <section className="seam-side seam-buyer">
          <div>
            <Section n="02" label="FOR BUYERS" align="right" />
            <p className="seam-copy">Train a personal Buying Agent that knows your preferences, budget and limits. It negotiates with seller agents for you.</p>
          </div>
          <div className="seam-foot" style={{ alignItems: 'flex-end' }}>
            <Link href="/onboard?role=buyer" className="btn accent">Train your agent <span className="arrow" aria-hidden>→</span></Link>
            <div className="uc-mono seam-note">No ads. No algorithm.</div>
          </div>
        </section>
      </div>

      <div className="via-stats">
        {stats.map(([lbl, val, sub], i) => (
          <div className="stat-cell" key={i}>
            <span className="stat-val tnum">{val}</span>
            <span className="uc-mono" style={{ fontSize: 9, color: 'var(--ink-3)' }}>{lbl} · {sub}</span>
          </div>
        ))}
      </div>

      <footer className="via-foot">
        <div className="via-foot-inner">
          <div className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>© VIA Labs Pte Ltd · Singapore</div>
          <nav className="via-foot-nav">
            <Link href="/faq" className="foot-faq">FAQ</Link>
            <a href="https://getvia.xyz/mcp">MCP endpoint ↗</a>
            <TestAgentBadge />
          </nav>
        </div>
      </footer>
    </div>
  );
}
