'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/app/ThemeToggle';
import { NotificationBell } from '@/components/app/NotificationBell';
import { Wordmark } from '@/components/app/Wordmark';
import TestAgentBadge from '@/components/app/TestAgentBadge';
import PersonaEditor from '@/components/app/PersonaEditor';

/* ──────────────────────────────────────────────────────────────────────────
   Seller dashboard, Maison design. Every number, row and card on this surface
   is read from the seller's real rows (app_seller_products, app_seller_quotes,
   app_purchases / app_distributions) by the server component and passed in as
   props. There is no seed or placeholder data here.
   ────────────────────────────────────────────────────────────────────────── */

export interface BrandOption { slug: string; name: string }
export interface Metrics {
  productsLive:  number;
  quotesTotal:   number;
  inNegotiation: number;
  paidOutUsdc:   number;
}
export interface ActivityRow {
  at:       string;
  who:      string;
  quoteRef: string;
  item:     string;
  amount:   number | null;
  status:   string;
}
export interface NegotiationRow {
  quoteRef: string;
  item:     string;
  buyer:    string;
  proposed: number | null;
  status:   string;
}
export interface ListingRow {
  title:       string;
  kind:        string;
  price:       number;
  pricingMode: string;
  status:      string;
}

const OPEN_LABEL: Record<string, string> = {
  pending_seller_approval: 'AWAITING YOU',
  countered_by_buyer:      'BUYER COUNTERED',
  revised_by_seller:       'YOU REVISED',
  approved:                'APPROVED',
  rejected:                'DECLINED',
  expired:                 'EXPIRED',
};

function usdc(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(11, 16);
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

function Ledger({ agentCode, rows }: { agentCode: string; rows: ActivityRow[] }) {
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
          <span>TIME</span><span>BY</span><span>ITEM</span><span style={{ textAlign: 'right' }}>STATUS</span><span style={{ textAlign: 'right' }}>USDC</span>
        </div>
        {rows.length === 0 && (
          <div className="ledger-row">
            <span className="lg-item" style={{ gridColumn: '1 / -1', color: 'var(--ink-3)' }}>
              No agent activity yet. When a buying agent opens a quote, every round shows here.
            </span>
          </div>
        )}
        {rows.map((r, i) => {
          const st = OPEN_LABEL[r.status] ?? r.status.toUpperCase();
          const sold = r.status === 'approved';
          return (
            <div className="ledger-row" key={i}>
              <span className="font-mono lg-dim">{hhmm(r.at)}</span>
              <span className="font-mono lg-buyer">{r.who.toUpperCase()}</span>
              <span className="lg-item">{r.item}</span>
              <span style={{ textAlign: 'right' }}>
                <span className="font-mono lg-status" style={{ color: sold ? 'var(--live)' : 'var(--ink-3)', borderColor: sold ? 'var(--live)' : 'var(--line-strong)' }}>{st}</span>
              </span>
              <span className="font-mono lg-amt" style={{ color: sold ? 'var(--ink)' : 'var(--ink-3)' }}>{r.amount == null ? '·' : usdc(r.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NegoCard({ n, slug }: { n: NegotiationRow; slug: string }) {
  return (
    <Link href={`/seller/${slug}/admin/quotes`} className="nego-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="nego-top">
        <div>
          <div className="nego-item">{n.item}</div>
          <div className="uc-mono nego-buyer">{n.buyer}</div>
        </div>
        <div className="nego-pill uc-mono open">{OPEN_LABEL[n.status] ?? n.status.toUpperCase()}</div>
      </div>
      <div className="nego-nums">
        <div><span className="uc-mono nego-k">QUOTE</span><span className="nego-v tnum" style={{ fontSize: 13 }}>{n.quoteRef}</span></div>
        <div className="nego-arrow">→</div>
        <div style={{ textAlign: 'right' }}><span className="uc-mono nego-k">ON THE TABLE</span><span className="nego-v tnum">{n.proposed == null ? '·' : usdc(n.proposed)}</span></div>
      </div>
      <div className="nego-actions">
        <span className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-2)' }}>Open in quote inbox →</span>
      </div>
    </Link>
  );
}

function Listing({ l }: { l: ListingRow }) {
  const cls = 's-' + l.status.toLowerCase().replace(/ /g, '-');
  return (
    <div className="lst-row">
      <span className="lst-item">{l.title}</span>
      <span className="font-mono lst-cat">{l.kind}</span>
      <span className="lst-price tnum">{usdc(l.price)}</span>
      <span className="font-mono lst-lead">{l.pricingMode === 'configurable' ? 'quote-based' : 'fixed price'}</span>
      <span style={{ textAlign: 'right' }}><span className={'lst-tag uc-mono ' + cls}>{l.status}</span></span>
    </div>
  );
}

export default function SellerDashboardClient({
  name, slug, sellerId, agentCode, mcpUrl, brands, metrics, activity, negotiations, listings, shippingNeedsSetup,
  headline, description, personaNeedsWork,
}: {
  name: string;
  slug: string;
  sellerId: string;
  agentCode: string;
  mcpUrl: string;
  brands: BrandOption[];
  metrics: Metrics;
  activity: ActivityRow[];
  negotiations: NegotiationRow[];
  listings: ListingRow[];
  shippingNeedsSetup: boolean;
  headline: string;
  description: string;
  personaNeedsWork: boolean;
}) {
  const router = useRouter();
  const productsHref = `/seller/${slug}/admin/products`;
  const salesHref    = `/seller/${slug}/admin/sales`;
  const agentHref    = `/seller/${slug}/admin/sales-agent`;
  const quotesHref   = `/seller/${slug}/admin/quotes`;
  const shippingHref = `/seller/${slug}/admin/shipping`;

  return (
    <div className="dash-page">
      <header className="via-top">
        <div className="via-top-inner">
          <nav className="dash-nav">
            <Link href={`/seller/${slug}/admin`} className="is-active">Dashboard</Link>
            <Link href={productsHref}>Products</Link>
            <Link href={shippingHref}>Shipping</Link>
            <Link href={quotesHref}>Quotes</Link>
            <Link href={salesHref}>Sales</Link>
          </nav>
          <Link href="/" aria-label="VIA home" style={{ display: 'inline-flex', justifyContent: 'center' }}><Wordmark /></Link>
          <div className="dash-right">
            {brands.length > 1 && (
              <select
                aria-label="Switch seller"
                value={slug}
                onChange={(e) => router.push(`/seller/${e.target.value}/admin`)}
                className="dash-mcp uc-mono"
                style={{ background: 'transparent', border: '1px solid var(--line-strong)', padding: '4px 8px', cursor: 'pointer' }}
              >
                {brands.map((b) => (
                  <option key={b.slug} value={b.slug}>{b.name}</option>
                ))}
              </select>
            )}
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
        {shippingNeedsSetup && (
          <Link
            href={shippingHref}
            style={{
              display: 'block', textDecoration: 'none',
              border: '1px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 20,
            }}
          >
            <div className="uc-mono" style={{ fontSize: 10, color: 'var(--warning)', marginBottom: 4 }}>Action needed · Shipping</div>
            <div style={{ fontSize: 14, color: 'var(--ink)' }}>
              You have a live physical product but no shipping policy, so buying agents cannot complete a delivery. Set your shipping rates now →
            </div>
          </Link>
        )}
        {personaNeedsWork && (
          <a
            href="#brand-persona"
            style={{
              display: 'block', textDecoration: 'none',
              border: '1px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 20,
            }}
          >
            <div className="uc-mono" style={{ fontSize: 10, color: 'var(--warning)', marginBottom: 4 }}>Action needed · Brand persona</div>
            <div style={{ fontSize: 14, color: 'var(--ink)' }}>
              Your brand persona is thin, so your Sales Agent has little to judge buyer briefs with and will miss matches. Tell it who your brand is →
            </div>
          </a>
        )}
        <div className="dash-subhead">
          <div>
            <span className="dash-eyebrow">· Seller</span>
            <h1 className="dash-h1">Good morning, <em>{name}</em>.</h1>
            <div className="dash-agentline">
              <span className="dash-agentpill">
                <LiveDot /> Your Sales Agent · {agentCode} ·{' '}
                {metrics.inNegotiation === 0
                  ? 'no live negotiations'
                  : `${metrics.inNegotiation} in negotiation now`}
              </span>
            </div>
          </div>
          <div className="dash-actions">
            <Link href={agentHref} className="btn ghost">Train agent</Link>
            <Link href={productsHref} className="btn">Add product</Link>
          </div>
        </div>

        <div className="dash-metrics">
          <Metric label="PRODUCTS LIVE"  val={metrics.productsLive}  sub="listed" />
          <Metric label="QUOTES"         val={metrics.quotesTotal}   sub="all time" />
          <Metric label="IN NEGOTIATION" val={metrics.inNegotiation} sub="open" />
          <Metric label="PAID OUT"       val={usdc(metrics.paidOutUsdc)} sub="USDC" />
        </div>

        <div className="dash-main">
          <Ledger agentCode={agentCode} rows={activity} />
          <div className="panel">
            <div className="panel-head">
              <h3>Open negotiations</h3>
              <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{negotiations.length} live</div>
            </div>
            <div className="nego-list">
              {negotiations.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 2px' }}>
                  No open quotes. When a buying agent calls request_quote on a configurable product, the thread opens here and in your <Link href={quotesHref} style={{ color: 'var(--ink-2)' }}>quote inbox</Link>.
                </p>
              )}
              {negotiations.map((n, i) => <NegoCard key={i} n={n} slug={slug} />)}
            </div>
          </div>
        </div>

        <div id="brand-persona" style={{ marginBottom: 24, scrollMarginTop: 80 }}>
          <PersonaEditor sellerId={sellerId} initialHeadline={headline} initialDescription={description} />
        </div>

        <div className="panel listings-panel">
          <div className="panel-head">
            <h3>Your listings</h3>
            <Link href={productsHref} className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--line-strong)', paddingBottom: 2 }}>Manage all →</Link>
          </div>
          <div className="lst">
            <div className="lst-row lst-head uc-mono">
              <span>PRODUCT</span><span>KIND</span><span>FROM</span><span>PRICING</span><span style={{ textAlign: 'right' }}>STATUS</span>
            </div>
            {listings.length === 0 && (
              <div className="lst-row">
                <span className="lst-item" style={{ color: 'var(--ink-3)' }}>No products yet.</span>
              </div>
            )}
            {listings.map((l, i) => <Listing key={i} l={l} />)}
          </div>
        </div>
      </div>

      <footer className="via-foot">
        <div className="via-foot-inner">
          <div className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>© VIA Labs Pte Ltd · Singapore</div>
          <nav className="via-foot-nav">
            <Link href="/">Home</Link>
            <Link href="/faq/sellers" className="foot-faq">FAQ</Link>
            <TestAgentBadge />
          </nav>
        </div>
      </footer>
    </div>
  );
}
