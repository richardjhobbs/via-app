'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';

/* ──────────────────────────────────────────────────────────────────────────
   Buyer dashboard, Maison design. Identity (name, agent code, MCP url) is real;
   the live-activity ledger and open-negotiation cards are design seed data, a
   visual prototype of the agent's work surface.
   ────────────────────────────────────────────────────────────────────────── */

const FEED = [
  { t: '07:04', seller: 'ELI·SA',     item: 'Daily croissants, dozen',  amt: '32'  },
  { t: '06:58', seller: 'agent/0x4c', item: 'Cold brew kegs, weekly',   amt: '180' },
  { t: '06:45', seller: 'agent/0x90', item: 'Compostable cups, 5k',     amt: '240' },
  { t: '06:30', seller: 'RYE·SA',     item: 'Sourdough, daily 20',      amt: '220' },
  { t: '06:12', seller: 'agent/0x33', item: 'Oat milk, 24 cartons',     amt: '96'  },
  { t: '05:55', seller: 'BEAN·SA',    item: 'Espresso beans, 10kg',     amt: '310' },
  { t: '05:40', seller: 'agent/0x77', item: 'Pastry boxes, 1k',         amt: '85'  },
];
const FSTATUS = ['SEARCHING', 'MATCHED', 'NEGOTIATING', 'BOOKED'];
const FCOLOR: Record<string, string> = {
  SEARCHING: 'var(--ink-3)', MATCHED: 'var(--accent)', NEGOTIATING: 'var(--accent)', BOOKED: 'var(--live)',
};

const NEGOS = [
  { seller: 'ELI·SA',     item: 'Daily croissants, dozen', cap: 32,  ask: 38  },
  { seller: 'agent/0x4c', item: 'Cold brew kegs, weekly',  cap: 180, ask: 210 },
  { seller: 'agent/0x90', item: 'Compostable cups, 5k',    cap: 240, ask: 275 },
];

const BRIEFS = [
  { brief: 'Daily croissants for the counter', cat: 'Pastry',   budget: '32 / day',  matches: '6', status: 'NEGOTIATING' },
  { brief: 'Cold brew kegs, weekly',           cat: 'Coffee',   budget: '180 / wk',  matches: '4', status: 'NEGOTIATING' },
  { brief: 'Compostable cups, 5k',             cat: 'Supplies', budget: '240',       matches: '9', status: 'SEARCHING' },
  { brief: 'Sourdough, daily 20 loaves',       cat: 'Bread',    budget: '220 / wk',  matches: '3', status: 'BOOKED' },
  { brief: 'Oat milk, monthly',                cat: 'Dairy',    budget: '96 / mo',   matches: '5', status: 'BOOKED' },
  { brief: 'Seasonal fruit tarts',             cat: 'Pastry',   budget: 'Open',      matches: '2', status: 'PAUSED' },
];

function useDrift(min: number, max: number, ms: number) {
  const [v, setV] = useState(Math.round((min + max) / 2));
  useEffect(() => {
    const id = setInterval(() => setV(Math.floor(min + Math.random() * (max - min + 1))), ms);
    return () => clearInterval(id);
  }, [min, max, ms]);
  return v;
}

function LiveDot() {
  return <span className="live-dot" aria-hidden />;
}

function Metric({ label, val, sub }: { label: string; val: string | number; sub: string }) {
  return (
    <div className="metric-cell">
      <div className="metric-val tnum">{val}</div>
      <div className="uc-mono metric-lbl">{label}<span style={{ color: 'var(--ink-3)' }}> · {sub}</span></div>
    </div>
  );
}

function Ledger({ agentCode }: { agentCode: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1900); return () => clearInterval(id); }, []);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Live activity</h3>
        <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <LiveDot /> {agentCode}
        </div>
      </div>
      <div className="ledger">
        <div className="ledger-row ledger-head uc-mono">
          <span>TIME</span><span>SELLER</span><span>ITEM</span><span style={{ textAlign: 'right' }}>STATUS</span><span style={{ textAlign: 'right' }}>USDC</span>
        </div>
        {FEED.map((r, i) => {
          const st = FSTATUS[(tick + i) % FSTATUS.length];
          return (
            <div className="ledger-row" key={i}>
              <span className="font-mono lg-dim">{r.t}</span>
              <span className="font-mono lg-buyer">{r.seller}</span>
              <span className="lg-item">{r.item}</span>
              <span style={{ textAlign: 'right' }}>
                <span className="font-mono lg-status" style={{ color: FCOLOR[st], borderColor: st === 'BOOKED' ? 'var(--live)' : 'var(--line-strong)' }}>{st}</span>
              </span>
              <span className="font-mono lg-amt" style={{ color: st === 'BOOKED' ? 'var(--ink)' : 'var(--ink-3)' }}>{r.amt}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NegoCard({ n }: { n: typeof NEGOS[number] }) {
  const [ask, setAsk] = useState(n.ask);
  const [status, setStatus] = useState<'open' | 'countered' | 'booked'>('open');
  const pct = Math.min(100, Math.round((n.cap / ask) * 100));
  const counter = () => { setAsk((a) => Math.max(n.cap, a - Math.ceil((a - n.cap) / 2))); setStatus('countered'); };
  const accept = () => setStatus('booked');
  return (
    <div className="nego-card">
      <div className="nego-top">
        <div>
          <div className="nego-item">{n.item}</div>
          <div className="uc-mono nego-buyer">{n.seller}</div>
        </div>
        <div className={'nego-pill uc-mono ' + status}>{status === 'booked' ? 'BOOKED' : status === 'countered' ? 'COUNTERED' : 'OPEN'}</div>
      </div>
      <div className="nego-nums">
        <div><span className="uc-mono nego-k">THEIR ASK</span><span className="nego-v tnum">{ask}</span></div>
        <div className="nego-arrow">{status === 'booked' ? '·' : '←'}</div>
        <div style={{ textAlign: 'right' }}><span className="uc-mono nego-k">YOUR CAP</span><span className="nego-v tnum">{n.cap}</span></div>
      </div>
      <div className="nego-bar"><span style={{ width: pct + '%', background: status === 'booked' ? 'var(--live)' : 'var(--accent)' }} /></div>
      <div className="nego-actions">
        {status === 'booked'
          ? <div className="uc-mono nego-done"><span className="d" /> BOOKED AT {ask} USDC</div>
          : <>
              <button className="nego-btn ghost" onClick={counter}>Let agent counter</button>
              <button className="nego-btn fill" onClick={accept} disabled={ask > n.cap} style={ask > n.cap ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                {ask > n.cap ? 'Over cap' : 'Book'}
              </button>
            </>}
      </div>
    </div>
  );
}

function Brief({ b }: { b: typeof BRIEFS[number] }) {
  const cls = 's-' + b.status.toLowerCase().replace(/ /g, '-');
  return (
    <div className="lst-row">
      <span className="lst-item">{b.brief}</span>
      <span className="font-mono lst-cat">{b.cat}</span>
      <span className="lst-price tnum">{b.budget}</span>
      <span className="font-mono lst-lead">{b.matches} matches</span>
      <span style={{ textAlign: 'right' }}><span className={'lst-tag uc-mono ' + cls}>{b.status}</span></span>
    </div>
  );
}

export default function BuyerDashboardClient({
  name, handle, agentCode, mcpUrl,
}: {
  name: string; handle: string; agentCode: string; mcpUrl: string;
}) {
  const matches = useDrift(28, 44, 2400);
  const intentsHref = `/buyer/${handle}/admin/intents`;
  const delegationHref = `/buyer/${handle}/admin/delegation`;
  return (
    <div className="dash-page">
      <header className="via-top">
        <div className="via-top-inner">
          <nav className="dash-nav">
            <Link href={`/buyer/${handle}/admin`} className="is-active">Dashboard</Link>
            <Link href={intentsHref}>Briefs</Link>
            <Link href={intentsHref}>Bookings</Link>
          </nav>
          <Link href="/" aria-label="VIA home" className="wordmark" style={{ textAlign: 'center' }}>VIA</Link>
          <div className="dash-right">
            <a href={mcpUrl} target="_blank" rel="noreferrer" className="dash-mcp uc-mono">MCP ↗</a>
            <div className="dash-acct"><span className="dash-avatar" />{name}</div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="dash-wrap">
        <div className="dash-subhead">
          <div>
            <span className="dash-eyebrow">· Buyer</span>
            <h1 className="dash-h1">Good morning, <em>{name}</em>.</h1>
            <div className="dash-agentline">
              <span className="dash-agentpill"><LiveDot /> Your Buying Agent · {agentCode} · negotiating 3 briefs now</span>
            </div>
          </div>
          <div className="dash-actions">
            <Link href={delegationHref} className="btn ghost">Adjust limits</Link>
            <Link href={intentsHref} className="btn">New brief</Link>
          </div>
        </div>

        <div className="dash-metrics">
          <Metric label="BRIEFS LIVE" val="4" sub="sourcing" />
          <Metric label="MATCHES FOUND" val={matches} sub="this week" />
          <Metric label="IN NEGOTIATION" val="3" sub="live" />
          <Metric label="SPENT · 30D" val="6,240" sub="USDC" />
        </div>

        <div className="dash-main">
          <Ledger agentCode={agentCode} />
          <div className="panel">
            <div className="panel-head">
              <h3>Open negotiations</h3>
              <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>3 live</div>
            </div>
            <div className="nego-list">
              {NEGOS.map((n, i) => <NegoCard key={i} n={n} />)}
            </div>
          </div>
        </div>

        <div className="panel listings-panel">
          <div className="panel-head">
            <h3>Your briefs</h3>
            <Link href={intentsHref} className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--line-strong)', paddingBottom: 2 }}>Manage all 9 →</Link>
          </div>
          <div className="lst">
            <div className="lst-row lst-head uc-mono">
              <span>BRIEF</span><span>CATEGORY</span><span>BUDGET</span><span>MATCHES</span><span style={{ textAlign: 'right' }}>STATUS</span>
            </div>
            {BRIEFS.map((b, i) => <Brief key={i} b={b} />)}
          </div>
        </div>
      </div>

      <footer className="via-foot">
        <div className="via-foot-inner">
          <div className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>© VIA Labs Pte Ltd · Singapore</div>
          <nav className="via-foot-nav">
            <Link href="/">Home</Link>
            <Link href="/faq/buyers" className="foot-faq">FAQ</Link>
            <span className="via-foot-badge"><span className="d" /> AGENT-READY</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
