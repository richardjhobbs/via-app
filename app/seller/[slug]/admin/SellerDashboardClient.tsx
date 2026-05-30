'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { NotificationBell } from '@/components/app/NotificationBell';

/* ──────────────────────────────────────────────────────────────────────────
   Seller dashboard, Maison design. Identity (name, agent code, MCP url) and the
   management links are real; the live-activity ledger, open-negotiation cards,
   metrics and listings table are design seed data, a visual prototype of the
   Sales Agent's work surface.
   ────────────────────────────────────────────────────────────────────────── */

const FEED = [
  { t: '07:04', buyer: 'NOVA·BA',    item: 'Alaïa wool dress, FR38',   amt: '1,450' },
  { t: '06:58', buyer: 'agent/0x4c', item: 'Cartier Trinity ring, 52', amt: '2,100' },
  { t: '06:45', buyer: 'ATLAS·BA',   item: 'RRL waxed jacket, M',      amt: '540'   },
  { t: '06:30', buyer: 'agent/0x90', item: 'LV Ursula bag',            amt: '3,200' },
  { t: '06:12', buyer: 'WREN·BA',    item: 'JPG cargo jeans, 31',      amt: '380'   },
  { t: '05:55', buyer: 'agent/0x33', item: 'Alaïa knit, FR40',         amt: '690'   },
  { t: '05:40', buyer: 'agent/0x77', item: 'Cartier Love band, 18',    amt: '4,100' },
];
const FSTATUS = ['ASKING', 'MATCHED', 'NEGOTIATING', 'SOLD'];
const FCOLOR: Record<string, string> = {
  ASKING: 'var(--ink-3)', MATCHED: 'var(--accent)', NEGOTIATING: 'var(--accent)', SOLD: 'var(--live)',
};

const NEGOS = [
  { buyer: 'NOVA·BA',    item: 'Alaïa wool dress, FR38',   floor: 1450, offer: 1290 },
  { buyer: 'agent/0x4c', item: 'Cartier Trinity ring, 52', floor: 2100, offer: 1980 },
  { buyer: 'ATLAS·BA',   item: 'RRL waxed jacket, M',      floor: 540,  offer: 470  },
];

const LISTINGS = [
  { product: 'Alaïa wool dress, FR38',   cat: 'Womenswear', price: '1,450', interest: '6 agents', status: 'NEGOTIATING' },
  { product: 'Cartier Trinity ring, 52', cat: 'Jewellery',  price: '2,100', interest: '9 agents', status: 'LIVE' },
  { product: 'RRL waxed jacket, M',      cat: 'Menswear',   price: '540',   interest: '4 agents', status: 'NEGOTIATING' },
  { product: 'LV Ursula bag',            cat: 'Bags',       price: '3,200', interest: '3 agents', status: 'LIVE' },
  { product: 'JPG cargo jeans, 31',      cat: 'Menswear',   price: '380',   interest: '5 agents', status: 'SOLD OUT' },
  { product: 'Cartier Love band, 18',    cat: 'Jewellery',  price: '4,100', interest: '2 agents', status: 'PAUSED' },
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
          <span>TIME</span><span>BUYER</span><span>ITEM</span><span style={{ textAlign: 'right' }}>STATUS</span><span style={{ textAlign: 'right' }}>USDC</span>
        </div>
        {FEED.map((r, i) => {
          const st = FSTATUS[(tick + i) % FSTATUS.length];
          return (
            <div className="ledger-row" key={i}>
              <span className="font-mono lg-dim">{r.t}</span>
              <span className="font-mono lg-buyer">{r.buyer}</span>
              <span className="lg-item">{r.item}</span>
              <span style={{ textAlign: 'right' }}>
                <span className="font-mono lg-status" style={{ color: FCOLOR[st], borderColor: st === 'SOLD' ? 'var(--live)' : 'var(--line-strong)' }}>{st}</span>
              </span>
              <span className="font-mono lg-amt" style={{ color: st === 'SOLD' ? 'var(--ink)' : 'var(--ink-3)' }}>{r.amt}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NegoCard({ n }: { n: typeof NEGOS[number] }) {
  const [offer, setOffer] = useState(n.offer);
  const [status, setStatus] = useState<'open' | 'countered' | 'booked'>('open');
  const pct = Math.min(100, Math.round((offer / n.floor) * 100));
  const counter = () => { setOffer((o) => Math.min(n.floor, o + Math.ceil((n.floor - o) / 2))); setStatus('countered'); };
  const accept = () => setStatus('booked');
  return (
    <div className="nego-card">
      <div className="nego-top">
        <div>
          <div className="nego-item">{n.item}</div>
          <div className="uc-mono nego-buyer">{n.buyer}</div>
        </div>
        <div className={'nego-pill uc-mono ' + status}>{status === 'booked' ? 'SOLD' : status === 'countered' ? 'COUNTERED' : 'OPEN'}</div>
      </div>
      <div className="nego-nums">
        <div><span className="uc-mono nego-k">THEIR OFFER</span><span className="nego-v tnum">{offer}</span></div>
        <div className="nego-arrow">{status === 'booked' ? '·' : '→'}</div>
        <div style={{ textAlign: 'right' }}><span className="uc-mono nego-k">YOUR FLOOR</span><span className="nego-v tnum">{n.floor}</span></div>
      </div>
      <div className="nego-bar"><span style={{ width: pct + '%', background: status === 'booked' ? 'var(--live)' : 'var(--accent)' }} /></div>
      <div className="nego-actions">
        {status === 'booked'
          ? <div className="uc-mono nego-done"><span className="d" /> SOLD AT {offer} USDC</div>
          : <>
              <button className="nego-btn ghost" onClick={counter}>Let agent counter</button>
              <button className="nego-btn fill" onClick={accept} disabled={offer < n.floor} style={offer < n.floor ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                {offer < n.floor ? 'Below floor' : 'Accept'}
              </button>
            </>}
      </div>
    </div>
  );
}

function Listing({ l }: { l: typeof LISTINGS[number] }) {
  const cls = 's-' + l.status.toLowerCase().replace(/ /g, '-');
  return (
    <div className="lst-row">
      <span className="lst-item">{l.product}</span>
      <span className="font-mono lst-cat">{l.cat}</span>
      <span className="lst-price tnum">{l.price}</span>
      <span className="font-mono lst-lead">{l.interest}</span>
      <span style={{ textAlign: 'right' }}><span className={'lst-tag uc-mono ' + cls}>{l.status}</span></span>
    </div>
  );
}

export default function SellerDashboardClient({
  name, slug, agentCode, mcpUrl,
}: {
  name: string; slug: string; agentCode: string; mcpUrl: string;
}) {
  const queries = useDrift(40, 72, 2400);
  const productsHref = `/seller/${slug}/admin/products`;
  const salesHref = `/seller/${slug}/admin/sales`;
  const shippingHref = `/seller/${slug}/admin/shipping`;
  const agentHref = `/seller/${slug}/admin/sales-agent`;
  return (
    <div className="dash-page">
      <header className="via-top">
        <div className="via-top-inner">
          <nav className="dash-nav">
            <Link href={`/seller/${slug}/admin`} className="is-active">Dashboard</Link>
            <Link href={productsHref}>Products</Link>
            <Link href={salesHref}>Sales</Link>
            <Link href={shippingHref}>Shipping</Link>
          </nav>
          <Link href="/" aria-label="VIA home" className="wordmark" style={{ textAlign: 'center' }}>VIA</Link>
          <div className="dash-right">
            <a href={mcpUrl} target="_blank" rel="noreferrer" className="dash-mcp uc-mono">MCP ↗</a>
            <NotificationBell />
            <div className="dash-acct"><span className="dash-avatar" />{name}</div>
            <ThemeToggle />
            <form action="/api/seller/auth/logout" method="post">
              <button type="submit" className="dash-mcp uc-mono">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <div className="dash-wrap">
        <div className="dash-subhead">
          <div>
            <span className="dash-eyebrow">· Seller</span>
            <h1 className="dash-h1">Good morning, <em>{name}</em>.</h1>
            <div className="dash-agentline">
              <span className="dash-agentpill"><LiveDot /> Your Sales Agent · {agentCode} · answering 3 buyers now</span>
            </div>
          </div>
          <div className="dash-actions">
            <Link href={agentHref} className="btn ghost">Train agent</Link>
            <Link href={productsHref} className="btn">Add product</Link>
          </div>
        </div>

        <div className="dash-metrics">
          <Metric label="PRODUCTS LIVE" val="5" sub="listed" />
          <Metric label="QUERIES" val={queries} sub="today" />
          <Metric label="IN NEGOTIATION" val="3" sub="live" />
          <Metric label="EARNED · 30D" val="18,400" sub="USDC" />
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
            <h3>Your listings</h3>
            <Link href={productsHref} className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--line-strong)', paddingBottom: 2 }}>Manage all →</Link>
          </div>
          <div className="lst">
            <div className="lst-row lst-head uc-mono">
              <span>PRODUCT</span><span>CATEGORY</span><span>PRICE</span><span>INTEREST</span><span style={{ textAlign: 'right' }}>STATUS</span>
            </div>
            {LISTINGS.map((l, i) => <Listing key={i} l={l} />)}
          </div>
        </div>
      </div>

      <footer className="via-foot">
        <div className="via-foot-inner">
          <div className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>© VIA Labs Pte Ltd · Singapore</div>
          <nav className="via-foot-nav">
            <Link href="/">Home</Link>
            <Link href="/faq/sellers" className="foot-faq">FAQ</Link>
            <span className="via-foot-badge"><span className="d" /> AGENT-READY</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
