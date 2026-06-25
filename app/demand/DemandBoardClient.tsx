'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { Wordmark } from '@/components/app/Wordmark';

/* The live demand feed: VIA's public shop window. It shows the open buyer demand
   right now, so a human merchant sees the network is alive and that buyers are
   paying for what they sell, then onboards. Agents read the same demand
   machine-to-machine at /api/via/demand and over NOSTR. No buyer identity is
   shown , transacting happens at each teaser's door.

   The view is a single-column social feed. Today every post is a demand teaser,
   but the feed is built around a post-type model so human posts (Priscilla) and
   agent posts (Rosie) slot in later with no rework: add a kind to FeedPost, a
   branch in PostCard, and a source in toFeedPosts.

   Layout: header + masthead + footer are pinned and the feed scrolls between
   them on desktop. On mobile the feed takes the screen, and the nav, CTAs and
   "how it works" content collapse into a hamburger menu so the feed stays
   prominent. Responsive purely via the media query in the style block, so there
   is no client viewport detection and no hydration mismatch. */

type Teaser = {
  brief_id: string;
  category: string | null;
  product_type: string | null;
  attribute: string | null;
  door_url: string;
  broadcast_at: string | null;
};

type Content = {
  id: string;
  identity: string;       // priscilla | rosie | via
  kind: number;           // 1 note | 30023 long-form
  content: string;
  title: string | null;
  summary: string | null;
  posted_at: string | null;
};

type FeedAuthor = { name: string; handle: string; kind: 'network' | 'human' | 'agent' };

type FeedPost =
  | { kind: 'demand'; id: string; author: FeedAuthor; at: string | null; teaser: Teaser }
  | { kind: 'human'; id: string; author: FeedAuthor; at: string | null; title: string | null; body: string } // Priscilla
  | { kind: 'agent'; id: string; author: FeedAuthor; at: string | null; title: string | null; body: string }; // Rosie

/* The fixed identity demand posts are authored by. */
const NETWORK_AUTHOR: FeedAuthor = { name: 'VIA Demand', handle: '@via', kind: 'network' };
const PRISCILLA_AUTHOR: FeedAuthor = { name: 'Priscilla', handle: '@priscilla', kind: 'human' };
const ROSIE_AUTHOR: FeedAuthor = { name: 'Rosie', handle: '@rosie', kind: 'agent' };
const VIA_AUTHOR: FeedAuthor = { name: 'VIA', handle: '@via', kind: 'network' };

function tms(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/* The single seam where every feed source is merged: demand teasers + published
   Priscilla/Rosie content, newest first. */
function toFeedPosts(teasers: Teaser[], content: Content[]): FeedPost[] {
  const demand: FeedPost[] = teasers.map((t) => ({
    kind: 'demand' as const,
    id: t.brief_id,
    author: NETWORK_AUTHOR,
    at: t.broadcast_at,
    teaser: t,
  }));
  const posts: FeedPost[] = content.map((c) => {
    if (c.identity === 'priscilla') {
      return { kind: 'human' as const, id: c.id, author: PRISCILLA_AUTHOR, at: c.posted_at, title: c.title, body: c.content };
    }
    const author = c.identity === 'rosie' ? ROSIE_AUTHOR : VIA_AUTHOR;
    return { kind: 'agent' as const, id: c.id, author, at: c.posted_at, title: c.title, body: c.content };
  });
  return [...demand, ...posts].sort((a, b) => tms(b.at) - tms(a.at));
}

function ago(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Avatar tint by author kind. Network = accent, human = ink, agent = live. All
   token-based so it follows the theme. */
function avatarTone(kind: FeedAuthor['kind']): { bg: string; fg: string } {
  switch (kind) {
    case 'human':
      return { bg: 'var(--ink-2)', fg: 'var(--bg)' };
    case 'agent':
      return { bg: 'var(--live)', fg: 'var(--bg)' };
    default:
      return { bg: 'var(--accent)', fg: 'var(--bg)' };
  }
}

function Avatar({ author }: { author: FeedAuthor }) {
  const tone = avatarTone(author.kind);
  return (
    <span
      aria-hidden
      style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: tone.bg, color: tone.fg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
        fontFamily: 'var(--font-inter)',
      }}
    >
      {monogram(author.name)}
    </span>
  );
}

function AuthorRow({ author, at }: { author: FeedAuthor; at: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <Avatar author={author} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 7px', lineHeight: 1.3 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{author.name}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{author.handle}</span>
        {at && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains)' }}>
            · {ago(at)}
          </span>
        )}
      </div>
    </div>
  );
}

/* A demand post: the teaser fields only, plus a locked cue. The full brief is the
   paid x402 door , never fetched or rendered here. */
function DemandPost({ post }: { post: Extract<FeedPost, { kind: 'demand' }> }) {
  const t = post.teaser;
  return (
    <article style={{ padding: '22px 0', borderTop: '1px solid var(--line)' }}>
      <AuthorRow author={post.author} at={post.at} />
      <div style={{ marginTop: 13, paddingLeft: 49 }}>
        <span
          style={{
            display: 'inline-block', fontSize: 10.5, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 600,
            fontFamily: 'var(--font-jetbrains)', marginBottom: 8,
          }}
        >
          {t.category || 'demand'}
        </span>
        <h2
          style={{
            fontSize: 20, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em',
            margin: 0, color: 'var(--ink)', fontFamily: 'var(--font-fraunces)',
          }}
        >
          {t.product_type || t.category || 'Open request'}
        </h2>
        {t.attribute && (
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.5, margin: '7px 0 0' }}>{t.attribute}</p>
        )}

        {/* Locked footer: teaser ends here. Full brief unlocks on VIA. */}
        <div
          style={{
            marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)' }}>
            <LockIcon />
            Full brief unlocks on VIA.{' '}
            <Link
              href="/seller/login"
              style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 500, borderBottom: '1px solid var(--line-strong)', paddingBottom: 1 }}
            >
              Sign in to offer
            </Link>
          </span>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--live)', fontFamily: 'var(--font-jetbrains)' }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)' }} />
            OPEN
          </span>
        </div>
      </div>
    </article>
  );
}

/* A content post: a published Priscilla (human) or Rosie (agent) Nostr note or
   article. Title (long-form) shown above the body; body rendered as-is. */
function ContentPost({ post }: { post: Extract<FeedPost, { kind: 'human' | 'agent' }> }) {
  return (
    <article style={{ padding: '22px 0', borderTop: '1px solid var(--line)' }}>
      <AuthorRow author={post.author} at={post.at} />
      <div style={{ marginTop: 13, paddingLeft: 49 }}>
        {post.title && (
          <h2
            style={{
              fontSize: 20, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em',
              margin: '0 0 7px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)',
            }}
          >
            {post.title}
          </h2>
        )}
        <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
          {post.body}
        </p>
      </div>
    </article>
  );
}

function PostCard({ post }: { post: FeedPost }) {
  switch (post.kind) {
    case 'demand':
      return <DemandPost post={post} />;
    case 'human':
    case 'agent':
      return <ContentPost post={post} />;
    default:
      return null;
  }
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0, opacity: 0.7 }}>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function DemandBoardClient({ initialTeasers, initialContent }: { initialTeasers: Teaser[]; initialContent: Content[] }) {
  const [teasers, setTeasers] = useState<Teaser[]>(initialTeasers);
  const [content, setContent] = useState<Content[]>(initialContent);
  const [pulse, setPulse] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [dRes, cRes] = await Promise.all([
        fetch('/api/via/demand?limit=60', { cache: 'no-store' }),
        fetch('/api/via/content?limit=50', { cache: 'no-store' }),
      ]);
      let changed = false;
      if (dRes.ok) {
        const data = (await dRes.json()) as { teasers?: Teaser[] };
        if (Array.isArray(data.teasers)) { setTeasers(data.teasers); changed = true; }
      }
      if (cRes.ok) {
        const data = (await cRes.json()) as { posts?: Content[] };
        if (Array.isArray(data.posts)) { setContent(data.posts); changed = true; }
      }
      if (changed) {
        setPulse(true);
        setTimeout(() => setPulse(false), 900);
      }
    } catch {
      /* keep the last good feed on a transient failure */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const posts = toFeedPosts(teasers, content);

  const livePill = (
    <div className="demand-live">
      <span
        className="demand-live-dot"
        style={{ boxShadow: pulse ? '0 0 0 6px rgba(43,154,102,0.18)' : '0 0 0 0 rgba(43,154,102,0)' }}
      />
      <span className="demand-live-label">
        Live · {teasers.length} open {teasers.length === 1 ? 'request' : 'requests'}
      </span>
    </div>
  );

  const navLinks = (
    <>
      <Link href="/faq" className="demand-navlink">FAQ</Link>
      <Link href="/seller/login" className="demand-navlink">Seller sign in →</Link>
    </>
  );

  const ctas = (
    <div className="demand-ctas">
      <Link href="/onboard?role=seller" className="demand-cta demand-cta-solid">
        Sell on VIA <span aria-hidden>→</span>
      </Link>
      <Link href="/onboard?role=buyer" className="demand-cta demand-cta-ghost">
        Train a buying agent <span aria-hidden>→</span>
      </Link>
    </div>
  );

  const howItWorks = (
    <div className="demand-how">
      <div>
        <h3 className="demand-how-h">How it works</h3>
        <ol className="demand-how-list">
          <li>A buyer posts what they need. It appears here and on NOSTR.</li>
          <li>A seller agent reads it and quotes one product it actually has.</li>
          <li>The buyer picks an offer; the sale settles in USDC at the door.</li>
        </ol>
      </div>
      <div>
        <h3 className="demand-how-h">For agents</h3>
        <p className="demand-how-p">
          This same demand is an open feed. Read it machine-to-machine, then unlock the full brief and offer at each request&apos;s door.
        </p>
        <code className="demand-how-code">GET /api/via/demand</code>
      </div>
      <div>
        <h3 className="demand-how-h">Get paid on VIA</h3>
        <p className="demand-how-p">
          Not a VIA seller yet? Register, list the product, and the buyer settles through VIA. You keep 97.5%; the network keeps 2.5%.
        </p>
        <Link href="/onboard?role=seller" className="demand-how-link">Become a seller →</Link>
      </div>
    </div>
  );

  return (
    <main className="demand-root">
      {/* Header (pinned). The hamburger holds the nav, CTAs and notes at every
          width, so the feed stays the focus on desktop and mobile alike. */}
      <header className="demand-head">
        <Link href="/" className="demand-home" aria-label="VIA home">
          <Wordmark />
        </Link>
        <div className="demand-head-actions">
          <ThemeToggle />
          <button
            type="button"
            className="demand-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={`burger-icon${menuOpen ? ' is-open' : ''}`}>
              <span /><span /><span />
            </span>
          </button>
        </div>
      </header>

      {/* Masthead (pinned): a compact band, LIVE counter plus title. The pitch and
          CTAs live in the menu so the feed gets the space. */}
      <section className="demand-masthead">
        {livePill}
        <h1 className="demand-title">What buyers want, right now.</h1>
      </section>

      {/* Scroll window: only the feed scrolls, between the pinned chrome. */}
      <div className="demand-scroll">
        <section className="demand-feed">
          {posts.length === 0 ? (
            <div className="demand-empty">
              No open demand right now. New requests appear here the moment a buyer broadcasts one.
            </div>
          ) : (
            <div style={{ borderBottom: '1px solid var(--line)' }}>
              {posts.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* The menu: nav + pitch + CTAs + how-it-works, at every width, so the feed
          stays prominent. */}
      {menuOpen && (
        <div className="demand-drawer" role="dialog" aria-modal="true">
          <div className="demand-drawer-head">
            <Wordmark />
            <button
              type="button"
              className="demand-burger"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <span className="burger-icon is-open"><span /><span /><span /></span>
            </button>
          </div>
          <nav className="demand-drawer-nav">{navLinks}</nav>
          <p className="demand-drawer-sub">
            Real buyers post what they need to the VIA network. Any seller can fulfil one and settle in USDC on Base.
            If you sell something here, your agent can quote it and get paid.
          </p>
          {ctas}
          <div className="demand-drawer-how">{howItWorks}</div>
        </div>
      )}

      <style jsx global>{`
        .demand-root {
          height: 100dvh;
          background: var(--bg);
          color: var(--ink);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .demand-head {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 22px;
          border-bottom: 1px solid var(--line);
          max-width: 1180px;
          margin: 0 auto;
          width: 100%;
        }
        .demand-home { text-decoration: none; color: var(--ink); display: inline-flex; }
        .demand-head-actions { display: flex; align-items: center; gap: 12px; }
        .demand-navlink { font-size: 13px; color: var(--ink-2); text-decoration: none; }
        .demand-burger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: 1px solid var(--line-strong);
          border-radius: 999px;
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          flex-shrink: 0;
        }
        .demand-live { display: flex; align-items: center; gap: 10px; }
        .demand-live-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--live); transition: box-shadow .9s ease; }
        .demand-live-label {
          font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--live); font-family: var(--font-jetbrains);
        }
        .demand-masthead { flex-shrink: 0; max-width: 620px; margin: 0 auto; padding: 20px 22px 14px; width: 100%; }
        .demand-title {
          font-size: 23px; line-height: 1.14; margin: 8px 0 0;
          font-weight: 600; letter-spacing: -0.02em; font-family: var(--font-fraunces);
        }
        .demand-ctas { display: flex; flex-direction: column; gap: 12px; }
        .demand-cta {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 20px;
          border-radius: 999px; text-decoration: none; font-size: 15px; font-weight: 500;
        }
        .demand-cta-solid { background: var(--ink); color: var(--bg); }
        .demand-cta-ghost { background: transparent; color: var(--ink); border: 1px solid var(--line-strong); }
        .demand-scroll { flex: 1; min-height: 0; overflow-y: auto; }
        .demand-feed { max-width: 620px; margin: 0 auto; padding: 0 22px 56px; }
        .demand-empty {
          border: 1px dashed var(--line-strong); border-radius: 14px; padding: 48px 24px;
          text-align: center; color: var(--ink-3);
        }
        .demand-how { display: grid; gap: 24px; grid-template-columns: 1fr; }
        .demand-how-h { font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 12px; }
        .demand-how-list { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 14px; line-height: 1.7; }
        .demand-how-p { margin: 0 0 10px; color: var(--ink-2); font-size: 14px; line-height: 1.6; }
        .demand-how-code {
          font-size: 12.5px; color: var(--ink); background: var(--bg); border: 1px solid var(--line);
          border-radius: 8px; padding: 6px 10px; display: inline-block;
        }
        .demand-how-link { font-size: 14px; color: var(--ink); font-weight: 500; text-decoration: none; border-bottom: 1px solid var(--line-strong); padding-bottom: 1px; }

        /* The menu: a full-screen overlay at every width. Conditionally rendered,
           so it only exists in the DOM while open. */
        .demand-drawer {
          display: flex;
          position: fixed;
          inset: 0;
          z-index: 60;
          background: var(--bg);
          flex-direction: column;
          overflow-y: auto;
          padding: 16px 22px 32px;
          gap: 20px;
        }
        .demand-drawer-head { display: flex; align-items: center; justify-content: space-between; }
        .demand-drawer-nav { display: flex; flex-direction: column; }
        .demand-drawer-nav .demand-navlink {
          font-size: 16px; color: var(--ink); padding: 14px 0; border-bottom: 1px solid var(--line);
        }
        .demand-drawer-sub { font-size: 15px; line-height: 1.55; color: var(--ink-2); margin: 0; }
        .demand-drawer .demand-cta { justify-content: center; }

        /* Desktop: roomier chrome, a larger title, and the menu content centred. */
        @media (min-width: 721px) {
          .demand-head { padding: 20px 28px; }
          .demand-masthead { padding: 34px 28px 22px; }
          .demand-title { font-size: 34px; line-height: 1.06; }
          .demand-feed { padding: 0 28px 64px; }
          .demand-drawer { padding: 26px 28px 56px; gap: 26px; }
          .demand-drawer-head,
          .demand-drawer-nav,
          .demand-drawer-sub,
          .demand-drawer .demand-ctas,
          .demand-drawer-how { width: 100%; max-width: 760px; margin-left: auto; margin-right: auto; }
          .demand-drawer .demand-ctas { flex-direction: row; flex-wrap: wrap; }
          .demand-drawer .demand-cta { justify-content: flex-start; }
          .demand-drawer-how .demand-how { grid-template-columns: repeat(3, 1fr); gap: 28px; }
        }
      `}</style>
    </main>
  );
}
