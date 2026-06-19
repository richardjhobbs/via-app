'use client';

import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { Wordmark } from '@/components/app/Wordmark';
import './flywheel.css';

/* ──────────────────────────────────────────────────────────────────────────
   VIA x Badge membership flywheel. Maison palette, animated:
   - hub rings pulse outward (network growth)
   - a marker orbits the loop clockwise
   - each node flashes in its beneficiary colour as the marker reaches it
   Beneficiary map: 1 Brands, 2 Badge, 3 Customer, 4 Customer, 5 Brands, 6 Customer.
   ────────────────────────────────────────────────────────────────────────── */

type Ben = 'brand' | 'badge' | 'cust';

interface Node {
  n: number; x: number; y: number; ben: Ben;
  lx: number; ly: number; anchor: 'start' | 'middle' | 'end';
  l1: string; l2: string;
}

// 6 nodes on a ring (cx 500, cy 400, R 195), clockwise from top.
const NODES: Node[] = [
  { n: 1, x: 500,   y: 205,   ben: 'brand', lx: 500, ly: 135, anchor: 'middle', l1: 'Brand joins RRG',  l2: 'co-branded VIA pass' },
  { n: 2, x: 668.9, y: 302.5, ben: 'badge', lx: 727, ly: 298, anchor: 'start',  l1: 'Pass to the wallet', l2: 'brand invites its base' },
  { n: 3, x: 668.9, y: 497.5, ben: 'cust',  lx: 727, ly: 493, anchor: 'start',  l1: 'VIA agent created',  l2: 'wallet + 1,000 credit' },
  { n: 4, x: 500,   y: 595,   ben: 'cust',  lx: 500, ly: 668, anchor: 'middle', l1: 'Agent shops VIA',    l2: 'across every brand' },
  { n: 5, x: 331.1, y: 497.5, ben: 'brand', lx: 273, ly: 493, anchor: 'end',    l1: 'Brand broadcasts',   l2: 'promotions via concierge' },
  { n: 6, x: 331.1, y: 302.5, ben: 'cust',  lx: 273, ly: 298, anchor: 'end',    l1: 'Network rewards',    l2: 'members recruit members' },
];

const CHEVRONS = [
  { x: 597.5, y: 231.1, r: 30 },
  { x: 695,   y: 400,   r: 90 },
  { x: 597.5, y: 568.9, r: 150 },
  { x: 402.5, y: 568.9, r: 210 },
  { x: 305,   y: 400,   r: 270 },
  { x: 402.5, y: 231.1, r: 330 },
];

const benClass: Record<Ben, string> = { brand: 'ben-brand', badge: 'ben-badge', cust: 'ben-cust' };
const benHalo: Record<Ben, string> = { brand: 'var(--accent)', badge: 'var(--danger)', cust: 'var(--live)' };

function Glyph({ n, x, y }: { n: number; x: number; y: number }) {
  switch (n) {
    case 1: // brand: card
      return <g className="fly-glyph"><rect x={x - 17} y={y - 12} width={34} height={24} rx={3} /><line x1={x - 17} y1={y - 4} x2={x + 17} y2={y - 4} /></g>;
    case 2: // wallet
      return <g className="fly-glyph"><rect x={x - 17} y={y - 11} width={34} height={22} rx={3} /><circle cx={x + 10} cy={y} r={2.6} /></g>;
    case 3: // spark + coin
      return <g className="fly-glyph"><path d={`M${x - 4} ${y - 16} L${x} ${y - 2} L${x + 14} ${y + 2} L${x} ${y + 6} L${x - 4} ${y + 18} L${x - 8} ${y + 6} L${x - 20} ${y + 2} L${x - 8} ${y - 2} Z`} transform="translate(4,0)" /></g>;
    case 4: // shopping bag
      return <g className="fly-glyph"><path d={`M${x - 14} ${y - 6} L${x + 14} ${y - 6} L${x + 11} ${y + 16} L${x - 11} ${y + 16} Z`} /><path d={`M${x - 7} ${y - 6} a7 7 0 0 1 14 0`} /></g>;
    case 5: // broadcast bubble
      return <g className="fly-glyph"><path d={`M${x - 15} ${y - 12} h26 a4 4 0 0 1 4 4 v13 a4 4 0 0 1 -4 4 h-15 l-9 7 v-7 a4 4 0 0 1 -4 -4 v-13 a4 4 0 0 1 4 -4 Z`} /><line x1={x - 9} y1={y - 3} x2={x + 9} y2={y - 3} /><line x1={x - 9} y1={y + 4} x2={x + 3} y2={y + 4} /></g>;
    default: // recruit: two heads + link arc
      return <g className="fly-glyph"><circle cx={x - 9} cy={y - 6} r={5} /><circle cx={x + 9} cy={y - 6} r={5} /><path d={`M${x - 17} ${y + 14} a8 8 0 0 1 16 0`} /><path d={`M${x + 1} ${y + 14} a8 8 0 0 1 16 0`} /></g>;
  }
}

export function BadgeClient() {
  return (
    <div className="badge-page">
      <header className="via-top">
        <div className="via-top-inner">
          <a href="https://getvia.xyz" className="via-top-link dash-eyebrow" style={{ color: 'var(--ink-3)' }}>
            <span aria-hidden>&larr;</span> getvia.xyz
          </a>
          <Link href="/" aria-label="VIA home" style={{ display: 'inline-flex', justifyContent: 'center' }}>
            <Wordmark />
          </Link>
          <div className="dash-right">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="badge-hero">
        <div className="badge-kicker">VIA &#215; BADGE</div>
        <h1 className="badge-h1">One pass. <em>The whole network.</em></h1>
        <p className="badge-sub">
          Every brand brings its customers. Every customer becomes an active VIA agent.
          The loop compounds, and the network stays live.
        </p>
      </section>

      <div className="flywheel-wrap">
        <svg viewBox="0 0 1000 720" role="img" aria-labelledby="fwt fwd">
          <title id="fwt">VIA x Badge membership flywheel</title>
          <desc id="fwd">A six-step loop around a growing VIA network core: a brand joins RRG and gets a co-branded pass, customers add it to their wallet and become VIA agents with sign-on credit, brands broadcast promotions and network rewards drive recruitment, all feeding the network.</desc>

          {/* spokes */}
          {NODES.map((nd) => (
            <line key={`sp${nd.n}`} className="fly-spoke" x1={500} y1={400} x2={nd.x} y2={nd.y} />
          ))}

          {/* guide ring */}
          <circle className="fly-ringguide" cx={500} cy={400} r={195} />

          {/* direction chevrons */}
          {CHEVRONS.map((c, i) => (
            <path key={`cv${i}`} className="fly-chev" d="M -7 -9 L 7 0 L -7 9" transform={`translate(${c.x},${c.y}) rotate(${c.r})`} />
          ))}

          {/* hub: pulsing rings + core */}
          <circle className="fly-hubring" cx={500} cy={400} r={70} fill="none" stroke="var(--accent)" strokeWidth={2} style={{ animationDelay: '0s' }} />
          <circle className="fly-hubring" cx={500} cy={400} r={70} fill="none" stroke="var(--accent)" strokeWidth={2} style={{ animationDelay: '2s' }} />
          <circle cx={500} cy={400} r={70} fill="var(--paper)" stroke="var(--accent)" strokeWidth={2.5} />
          <text className="fly-hubt" x={500} y={395} textAnchor="middle">VIA NETWORK</text>
          <text className="fly-hubs" x={500} y={416} textAnchor="middle">GROWS &amp; STAYS LIVE</text>

          {/* nodes */}
          {NODES.map((nd, i) => {
            const delay = `${(2 * i).toFixed(2)}s`;
            const bx = nd.x;
            const by = nd.y - 30; // number badge sits inside the node, above the glyph
            return (
              <g key={`nd${nd.n}`}>
                <circle className="fly-halo" cx={nd.x} cy={nd.y} r={46} fill={benHalo[nd.ben]} opacity={0} style={{ animationDelay: delay }} />
                <g className="fly-node" style={{ animationDelay: delay }}>
                  <circle className="fly-card" cx={nd.x} cy={nd.y} r={48} />
                  <Glyph n={nd.n} x={nd.x} y={nd.y + 6} />
                  <circle cx={bx} cy={by} r={11} className={benClass[nd.ben]} />
                  <text className="fly-num" x={bx} y={by + 4} textAnchor="middle">{nd.n}</text>
                </g>
                <text className="fly-lbl" x={nd.lx} y={nd.ly} textAnchor={nd.anchor}>{nd.l1}</text>
                <text className="fly-lbl2" x={nd.lx} y={nd.ly + 18} textAnchor={nd.anchor}>{nd.l2}</text>
              </g>
            );
          })}

          {/* orbiting marker */}
          <g className="fly-orbit">
            <path className="fly-comet-tail" d="M385.3 242.2 A195 195 0 0 1 500 205" />
            <circle className="fly-comet" cx={500} cy={205} r={7} />
          </g>
        </svg>
      </div>

      <div className="fly-legend">
        <span className="item"><span className="dot" style={{ background: 'var(--accent)' }} /><span className="nm">Brands</span><span className="ds">join the network</span></span>
        <span className="item"><span className="dot" style={{ background: 'var(--danger)' }} /><span className="nm">Badge</span><span className="ds">engagement and loyalty</span></span>
        <span className="item"><span className="dot" style={{ background: 'var(--live)' }} /><span className="nm">Customers</span><span className="ds">agentic network</span></span>
      </div>

      <div className="badge-cta">
        <Link href="/onboard" className="btn accent">Apply as a brand <span className="arrow" aria-hidden>&rarr;</span></Link>
        <Link href="/faq" className="btn ghost">See how VIA works</Link>
      </div>
    </div>
  );
}
