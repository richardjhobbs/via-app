'use client';

import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { Wordmark } from '@/components/app/Wordmark';
import TestAgentBadge from '@/components/app/TestAgentBadge';
import MatchNotifyDot from '@/components/app/MatchNotifyDot';

/* ──────────────────────────────────────────────────────────────────────────
   Buyer dashboard, Maison design. Every figure is real: identity plus the
   buyer's own briefs (app_buyer_intents) and trained preferences
   (app_buyer_memories). No fabricated activity/negotiation/spend , an untrained
   agent is told it is untrained and pointed at its training surface.
   ────────────────────────────────────────────────────────────────────────── */

export interface BriefRow {
  id: string;
  text: string;
  status: string;
  createdAt: string;
  matchCount: number;
}

export interface MatchRow {
  id: string;
  title: string;
  sellerName: string;
  priceUsdc: number | null;
  currency: string;
  productUrl: string;
  createdAt: string;
}

export interface PitchRow {
  id: string;
  productTitle: string;
  priceUsdc: number | null;
  url: string | null;
  /** Canonical buyable VIA product page (/sellers/{slug}/products/{id}). Present
   *  only for transactable VIA sellers; drives the "Buy now" CTA. */
  buyUrl: string | null;
  seller: string;
  fits: boolean;
  /** fit = every hard requirement met; partial = some met, some not; nofit = none. */
  tier: 'fit' | 'partial' | 'nofit';
  /** Hard requirements this product satisfies / does not , drives the partial diff text. */
  met: string[];
  unmet: string[];
  score: number;
  reason: string;
  briefText: string;
  createdAt: string;
}

const OPEN_STATUSES = ['open', 'broadcast', 'matched'];

function LiveDot() {
  return <span className="live-dot" aria-hidden />;
}

function Metric({ label, val, sub, href }: { label: string; val: string | number; sub: string; href?: string }) {
  const inner = (
    <>
      <div className="metric-val tnum">{val}</div>
      <div className="uc-mono metric-lbl">{label}<span style={{ color: 'var(--ink-3)' }}> · {sub}</span></div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="metric-cell" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        {inner}
      </Link>
    );
  }
  return <div className="metric-cell">{inner}</div>;
}

function BriefItem({ b }: { b: BriefRow }) {
  const open = OPEN_STATUSES.includes(b.status);
  const searchingEmpty = open && b.matchCount === 0;
  return (
    <div className="lst-row" style={searchingEmpty ? { display: 'block' } : undefined}>
      {searchingEmpty ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <span className="lst-item">{b.text}</span>
            <span className="lst-tag uc-mono" style={{ color: 'var(--live)', borderColor: 'var(--live)' }}>{b.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            Broadcast to the network. No offers yet for this brief. It stays open and sellers will offer as they find a match.
          </div>
        </>
      ) : (
        <>
          <span className="lst-item">{b.text}</span>
          <span className="font-mono lst-lead">{new Date(b.createdAt).toISOString().slice(0, 10)}</span>
          <span style={{ textAlign: 'right' }}>
            <span
              className="lst-tag uc-mono"
              style={{
                color: open ? 'var(--live)' : 'var(--ink-3)',
                borderColor: open ? 'var(--live)' : 'var(--line-strong)',
              }}
            >
              {b.status}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

function priceLabel(m: MatchRow): string {
  if (m.priceUsdc === null) return 'price on request';
  return `${m.priceUsdc.toFixed(2)} ${m.currency}`;
}

export default function BuyerDashboardClient({
  name, handle, buyerId, agentCode, mcpUrl, prefsCount, openBriefs, briefs, matches, matchCount, newCount, pitches, offersCount, newPitchCount, credits,
}: {
  name: string;
  handle: string;
  buyerId: string;
  agentCode: string;
  mcpUrl: string;
  prefsCount: number;
  openBriefs: number;
  briefs: BriefRow[];
  matches: MatchRow[];
  matchCount: number;
  newCount: number;
  pitches: PitchRow[];
  offersCount: number;
  newPitchCount: number;
  credits: number;
}) {
  const trainHref = `/buyer/${handle}/admin/buying-agent`;
  const intentsHref = `/buyer/${handle}/admin/intents`;
  const delegationHref = `/buyer/${handle}/admin/delegation`;
  const creditsHref = `/buyer/${handle}/admin/credits`;
  const matchesHref = `/buyer/${handle}/admin/matches`;
  const purchasesHref = `/buyer/${handle}/admin/purchases`;

  const trained = prefsCount > 0;
  const hasBriefs = briefs.length > 0;
  const blankSlate = !trained && !hasBriefs;

  const agentLine = trained
    ? `Your Buying Agent · ${agentCode} · ${prefsCount} ${prefsCount === 1 ? 'preference' : 'preferences'} trained`
    : `Your Buying Agent · ${agentCode} · not yet trained`;

  return (
    <div className="dash-page">
      <header className="via-top">
        <div className="via-top-inner">
          <nav className="dash-nav">
            <Link href={`/buyer/${handle}/admin`} className="is-active" style={{ display: 'inline-flex', alignItems: 'center' }}>Dashboard<MatchNotifyDot buyerId={buyerId} /></Link>
            <Link href={intentsHref}>Briefs</Link>
            <Link href={trainHref}>Train</Link>
            <Link href={purchasesHref}>Purchases</Link>
            <Link href={creditsHref}>Credits</Link>
          </nav>
          <Link href="/" aria-label="VIA home" style={{ display: 'inline-flex', justifyContent: 'center' }}><Wordmark /></Link>
          <div className="dash-right">
            <a href={mcpUrl} target="_blank" rel="noreferrer" className="dash-mcp uc-mono">MCP ↗</a>
            <div className="dash-acct"><span className="dash-avatar" />{name}</div>
            <form action="/api/buyer/auth/logout" method="post" style={{ display: 'inline-flex' }}>
              <button type="submit" className="dash-mcp uc-mono">Sign out</button>
            </form>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="dash-wrap">
        <div className="dash-subhead">
          <div>
            <span className="dash-eyebrow">· Buyer</span>
            <h1 className="dash-h1">Welcome, <em>{name}</em>.</h1>
            <div className="dash-agentline">
              <span className="dash-agentpill"><LiveDot /> {agentLine}</span>
            </div>
          </div>
          <div className="dash-actions">
            <Link href={delegationHref} className="btn ghost">Adjust limits</Link>
            {trained
              ? <Link href={intentsHref} className="btn">New brief</Link>
              : <Link href={trainHref} className="btn">Train your agent</Link>}
          </div>
        </div>

        <div className="dash-metrics">
          <Metric label="CREDITS" val={credits.toLocaleString()} sub="balance" href={creditsHref} />
          <Metric label="BRIEFS LIVE" val={openBriefs} sub="broadcast" href={intentsHref} />
          <Metric label="OFFERS" val={offersCount} sub="from sellers" href={matchesHref} />
          <Metric label="PREFERENCES" val={prefsCount} sub="trained" href={trainHref} />
        </div>

        {pitches.length > 0 && (
          <div className="panel listings-panel">
            <div className="panel-head">
              <h3>Offers</h3>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                {newPitchCount > 0 && (
                  <span className="new-results-pill"><span className="d" aria-hidden />{newPitchCount} new</span>
                )}
                <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>sellers offering against your briefs</div>
              </div>
            </div>
            <div className="lst">
              {pitches.map((p) => {
                // A fits offer is buyable at the VIA product page (buyUrl) or, for
                // non-VIA sellers (e.g. RRG), the seller's own product page (url).
                // The top-right pill becomes a "Buy now" CTA in place of the "fits"
                // tag, styled identically (live green). Internal links nav in-tab;
                // external ones open a new tab.
                const buyTarget = p.buyUrl ?? p.url;
                const buyInternal = Boolean(p.buyUrl);
                const showBuy = p.tier === 'fit' && Boolean(buyTarget);
                const titleHref = buyTarget;
                const titleExternal = !buyInternal && Boolean(p.url);
                const pillStyle = { color: 'var(--live)', borderColor: 'var(--live)', textDecoration: 'none', flexShrink: 0 } as const;
                // Three states: fit (green), partial (amber , some requirements met),
                // no fit (grey). Partial surfaces the specific differences below.
                const tagColor = p.tier === 'fit' ? 'var(--live)' : p.tier === 'partial' ? 'var(--warning)' : 'var(--ink-3)';
                const tagLabel = p.tier === 'fit' ? 'fits' : p.tier === 'partial' ? 'partial' : 'no fit';
                return (
                  <div key={p.id} className="lst-row" style={{ display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                      <span className="lst-item">
                        {titleHref
                          ? <a href={titleHref} {...(titleExternal ? { target: '_blank', rel: 'noreferrer' } : {})} style={{ color: 'inherit', textDecoration: 'none' }}>{p.productTitle}</a>
                          : p.productTitle}
                      </span>
                      {showBuy ? (
                        buyInternal ? (
                          <Link href={buyTarget!} className="lst-tag uc-mono" style={pillStyle}>Buy now</Link>
                        ) : (
                          <a href={buyTarget!} target="_blank" rel="noreferrer" className="lst-tag uc-mono" style={pillStyle}>Buy now</a>
                        )
                      ) : (
                        <span className="lst-tag uc-mono" style={{ color: tagColor, borderColor: tagColor }}>
                          {tagLabel}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                      {p.seller}{typeof p.priceUsdc === 'number' ? ` · ${p.priceUsdc.toFixed(2)} USDC` : ''}
                      {p.briefText ? ` · for "${p.briefText.slice(0, 60)}"` : ''}
                      {p.reason ? ` · ${p.reason}` : ''}
                    </div>
                    {p.tier === 'partial' && (p.met.length > 0 || p.unmet.length > 0) && (
                      <div style={{ fontSize: 11.5, marginTop: 3 }}>
                        {p.met.length > 0 && (
                          <span style={{ color: 'var(--live)' }}>Matches: {p.met.join(', ')}</span>
                        )}
                        {p.met.length > 0 && p.unmet.length > 0 && <span style={{ color: 'var(--ink-3)' }}>{'  ·  '}</span>}
                        {p.unmet.length > 0 && (
                          <span style={{ color: 'var(--warning)' }}>Differs on: {p.unmet.join(', ')}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <div className="panel listings-panel">
            <div className="panel-head">
              <h3>Might also interest you</h3>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                {newCount > 0 && (
                  <span className="new-results-pill"><span className="d" aria-hidden />{newCount} new</span>
                )}
                <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>not an exact match to your brief, but worth a look</div>
                <Link href={matchesHref} className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--line-strong)', paddingBottom: 2 }}>
                  View all →
                </Link>
              </div>
            </div>
            <div className="lst">
              <div className="lst-row lst-head uc-mono">
                <span>PRODUCT</span><span>SELLER</span><span style={{ textAlign: 'right' }}>PRICE</span>
              </div>
              {matches.map((m) => (
                <a
                  key={m.id}
                  href={m.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="lst-row"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <span className="lst-item">{m.title}</span>
                  <span className="font-mono lst-lead">{m.sellerName}</span>
                  <span className="lst-price tnum" style={{ textAlign: 'right' }}>{priceLabel(m)}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {blankSlate ? (
          <div className="panel">
            <div className="panel-head">
              <h3>Get your agent working</h3>
            </div>
            <div style={{ padding: '24px 20px', display: 'grid', gap: 20 }}>
              <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6, maxWidth: 560 }}>
                Your Buying Agent is live but has nothing to act on yet. Two steps to start:
                brief it on how you like to buy, then tell it what you are looking for. Seller
                agents reach it at <code className="font-mono" style={{ color: 'var(--ink)' }}>{`/buyers/${handle}/mcp`}</code>.
              </p>
              <div className="dash-actions">
                <Link href={trainHref} className="btn">Train your agent</Link>
                <Link href={intentsHref} className="btn ghost">Add a brief</Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="panel listings-panel">
            <div className="panel-head">
              <h3>Your briefs</h3>
              <Link href={intentsHref} className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--line-strong)', paddingBottom: 2 }}>
                {hasBriefs ? 'Manage all →' : 'Add a brief →'}
              </Link>
            </div>
            {hasBriefs ? (
              <div className="lst">
                <div className="lst-row lst-head uc-mono">
                  <span>BRIEF</span><span>CREATED</span><span style={{ textAlign: 'right' }}>STATUS</span>
                </div>
                {briefs.map((b) => <BriefItem key={b.id} b={b} />)}
              </div>
            ) : (
              <div style={{ padding: '24px 20px' }}>
                <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>
                  No briefs yet. <Link href={intentsHref} style={{ color: 'var(--ink)', textDecoration: 'underline' }}>Add one</Link> to point your agent at what you want.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="via-foot">
        <div className="via-foot-inner">
          <div className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>© VIA Labs Pte Ltd · Singapore</div>
          <nav className="via-foot-nav">
            <Link href="/">Home</Link>
            <Link href="/faq/buyers" className="foot-faq">FAQ</Link>
            <TestAgentBadge />
          </nav>
        </div>
      </footer>
    </div>
  );
}
