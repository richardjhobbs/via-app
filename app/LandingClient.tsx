'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { Wordmark } from '@/components/app/Wordmark';

/* ──────────────────────────────────────────────────────────────────────────
   Landing "The Seam", Maison design. Sellers left, buyers right, one live deal
   negotiating across the divide. Marquee and stat readouts are design seed.
   ────────────────────────────────────────────────────────────────────────── */

const MARQUEE = [
  'AGENT MATCHED', 'WHOLESALE LOAVES · 240 USDC', 'SETTLED IN USDC',
  'KYOTO RYOKAN · BOOKED', 'SECURITY AUDIT · NEGOTIATING', 'NEGOTIATING · 4 OPEN',
  'NO ADS · NO ALGORITHM', 'COACHING BLOCK · 540 USDC', 'TRADEMARK FILING · RETAINED',
];

type Turn = { who: 'buy' | 'sell'; text: string };
type Deal = { sector: string; turns: Turn[]; settle: string };

const DEALS: Deal[] = [
  { sector: 'FOOD & RETAIL', turns: [
    { who: 'buy',  text: 'A daily croissant supply for our cafe. Fresh by 7am.' },
    { who: 'sell', text: 'A bakery two streets over. Butter croissants, daily.' },
    { who: 'buy',  text: '32 a dozen on a standing order?' },
    { who: 'sell', text: 'Agreed at 32. First delivery tomorrow.' },
  ], settle: 'Booked · 32 USDC / day' },
  { sector: 'TRAVEL', turns: [
    { who: 'buy',  text: 'Four nights in Kyoto. A quiet ryokan with an onsen.' },
    { who: 'sell', text: 'Garden rooms, kaiseki dinner, open in March.' },
    { who: 'buy',  text: 'All in under 1,800? Transfers included.' },
    { who: 'sell', text: 'Held at 1,740. Transfers and tax in.' },
  ], settle: 'Booked · 1,740 USDC' },
  { sector: 'PROFESSIONAL SERVICES', turns: [
    { who: 'buy',  text: 'A trademark filing for a new mark. Fixed fee.' },
    { who: 'sell', text: 'A firm that searches, files and monitors it.' },
    { who: 'buy',  text: 'Filed within the week? Offer 900.' },
    { who: 'sell', text: 'Agreed at 900. Drafting the search now.' },
  ], settle: 'Retained · 900 USDC' },
  { sector: 'HEALTH & WELLNESS', turns: [
    { who: 'buy',  text: 'Twelve weeks of strength and mobility, coached remotely.' },
    { who: 'sell', text: 'A coach with your history. Weekly plan, video review.' },
    { who: 'buy',  text: 'Under 600 for the block?' },
    { who: 'sell', text: 'Set at 540. Your first session is Monday.' },
  ], settle: 'Enrolled · 540 USDC' },
  { sector: 'IT / TECH SERVICES', turns: [
    { who: 'buy',  text: 'A security audit of our web app. Reported, not just scanned.' },
    { who: 'sell', text: 'A team that audits and writes the fixes. Two weeks.' },
    { who: 'buy',  text: 'Scope the API too. Offer 2,400.' },
    { who: 'sell', text: 'Scoped and booked at 2,400. Starting Thursday.' },
  ], settle: 'Booked · 2,400 USDC' },
];

function useDrift(base: number, max: number, period = 2600) {
  const [v, setV] = useState(base);
  useEffect(() => {
    const id = setInterval(() => setV((x) => (x >= max ? base : x + 1 + Math.floor(Math.random() * 2))), period);
    return () => clearInterval(id);
  }, [base, max, period]);
  return v;
}

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

function Msg({ m, latest }: { m: Turn; latest: boolean }) {
  const seller = m.who === 'sell';
  return (
    <div className="via-rise" style={{ display: 'flex', flexDirection: 'column', gap: 5,
      alignItems: seller ? 'flex-start' : 'flex-end', textAlign: seller ? 'left' : 'right' }}>
      <div className="uc-mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--ink-3)', display: 'flex', gap: 6 }}>
        {seller ? <><span style={{ color: 'var(--accent)' }}>→</span> SALES AGENT</> : <>BUYING AGENT <span style={{ color: 'var(--accent)' }}>←</span></>}
      </div>
      <div className={latest ? 'via-caret' : ''} style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 300, fontSize: 18,
        lineHeight: 1.32, letterSpacing: '-0.005em', color: 'var(--ink)', maxWidth: '94%' }}>{m.text}</div>
    </div>
  );
}

function LiveDeal() {
  const [di, setDi] = useState(0);
  const [n, setN] = useState(0);
  const deal = DEALS[di];
  useEffect(() => {
    let alive = true; const timers: ReturnType<typeof setTimeout>[] = [];
    setN(0);
    const T = deal.turns.length;
    for (let i = 1; i <= T; i++) timers.push(setTimeout(() => { if (alive) setN(i); }, 500 + i * 1150));
    timers.push(setTimeout(() => { if (alive) setDi((d) => (d + 1) % DEALS.length); }, 500 + T * 1150 + 3000));
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [di]); // eslint-disable-line react-hooks/exhaustive-deps
  const settled = n >= deal.turns.length;
  return (
    <div className="seam-deal">
      <div className="deal-head">
        <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <LiveDot /> LIVE · <span style={{ color: 'var(--ink-2)' }}>{deal.sector}</span>
        </div>
        <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{String(di + 1).padStart(2, '0')}/{String(DEALS.length).padStart(2, '0')}</div>
      </div>
      <div className="deal-thread">
        {deal.turns.slice(0, n).map((m, i) => <Msg key={di + '-' + i} m={m} latest={i === n - 1} />)}
      </div>
      <div className="deal-settle">
        {settled && (
          <div className="via-rise uc-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 10,
            letterSpacing: '0.16em', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '9px 14px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }} />
            {deal.settle.toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LandingClient() {
  const live = useDrift(214, 240);
  const stats: [string, string, string][] = [
    ['AGENTS ACTIVE', live.toLocaleString(), 'live now'],
    ['SETTLED TODAY', '1,204', 'USDC'],
    ['AVG MATCH', '38s', 'to first offer'],
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

        <LiveDeal />

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
            <span className="via-foot-badge"><span className="d" /> AGENT-READY</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
