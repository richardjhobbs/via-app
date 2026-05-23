'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import LoginButton from './LoginButton';
import NavSearch from './NavSearch';
import ThemeToggle from './ThemeToggle';

type NavKey = 'store' | 'brands' | 'concierge' | 'cocreators' | 'agent' | 'drops';

/**
 * Static fallback items used before /api/rrg/marquee returns, and if that
 * request fails. Items 2 to 4 match what the API returns so any swap after
 * mount is subtle.
 */
const FALLBACK_MARQUEE_ITEMS = [
  'Now admitting founding brands',
  'Your concierge, quietly attentive, agent-ready',
  'A fashion-first commerce platform',
];

/**
 * RRGHeader: Maison topbar.
 *
 * Structure: announcement marquee above, then sticky topbar with
 * left nav / centered wordmark / right actions (Sign in + theme toggle).
 *
 * The marquee fetches items from /api/rrg/marquee on mount and refreshes
 * every 30 seconds so a live open brief + a rotating "New admission" brand
 * keep the ticker relevant. `active` can be passed explicitly; otherwise
 * we derive it from the path.
 */
export default function RRGHeader({ active, showMarquee = true }: { active?: NavKey; showMarquee?: boolean }) {
  const pathname = usePathname() || '';
  const current = active ?? inferActive(pathname);

  const [items, setItems] = useState<string[]>(FALLBACK_MARQUEE_ITEMS);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Poll for unread notification count to drive the Concierge nav dot.
  // 401 / 0 / network failure all silently render no badge.
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const r = await fetch('/api/agent/session/unread-count', { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as { count?: number };
        if (!cancelled) setUnreadCount(typeof data.count === 'number' ? data.count : 0);
      } catch {
        // silent: keep last known count
      }
    };
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!showMarquee) return;
    let cancelled = false;

    const fetchItems = async () => {
      try {
        const r = await fetch('/api/rrg/marquee', { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as { items?: string[] };
        if (!cancelled && Array.isArray(data.items) && data.items.length > 0) {
          setItems(data.items);
        }
      } catch {
        // Silent: keep whatever items we last had.
      }
    };

    fetchItems();
    const id = setInterval(fetchItems, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showMarquee]);

  return (
    <>
      {showMarquee && (
        <div className="marquee">
          <div className="marquee-track">
            {renderMarqueeRun(items)}
            {/* Duplicate the run so the CSS translate loops seamlessly. */}
            {renderMarqueeRun(items)}
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <nav className="topbar-nav">
            <Link href="/rrg" className={current === 'store' ? 'is-active' : ''}>Store</Link>
            <Link href="/brand" className={current === 'brands' ? 'is-active' : ''}>Brands</Link>
            <Link
              href="/agents"
              className={current === 'concierge' ? 'is-active' : ''}
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              aria-label={unreadCount > 0 ? `Concierge, ${unreadCount} unread` : 'Concierge'}
            >
              Concierge
              {unreadCount > 0 && (
                <span
                  className="nav-unread-dot"
                  aria-hidden="true"
                  title={`${unreadCount} unread`}
                />
              )}
            </Link>
            <Link href="/cocreators" className={current === 'cocreators' ? 'is-active' : ''}>Co-creators</Link>
          </nav>

          <button
            type="button"
            className="topbar-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="topbar-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={`burger-icon${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
              <span /><span /><span />
            </span>
          </button>

          <Link href="/" className="wordmark" style={{ textAlign: 'center', textDecoration: 'none', color: 'inherit' }}>
            Real Real Genuine
          </Link>

          <div className="topbar-right">
            <NavSearch variant="desktop" />
            <LoginButton />
            <ThemeToggle />
          </div>
        </div>

        <div
          id="topbar-mobile-menu"
          className={`topbar-mobile${menuOpen ? ' is-open' : ''}`}
          hidden={!menuOpen}
        >
          <NavSearch variant="mobile" />
          <Link href="/rrg" className={current === 'store' ? 'is-active' : ''}>Store</Link>
          <Link href="/brand" className={current === 'brands' ? 'is-active' : ''}>Brands</Link>
          <Link
            href="/agents"
            className={current === 'concierge' ? 'is-active' : ''}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            aria-label={unreadCount > 0 ? `Concierge, ${unreadCount} unread` : 'Concierge'}
          >
            Concierge
            {unreadCount > 0 && (
              <span className="nav-unread-dot" aria-hidden="true" title={`${unreadCount} unread`} />
            )}
          </Link>
          <Link href="/cocreators" className={current === 'cocreators' ? 'is-active' : ''}>Co-creators</Link>
        </div>
      </header>
    </>
  );
}

function inferActive(pathname: string): NavKey | undefined {
  if (pathname.startsWith('/agents')) return 'concierge';
  if (pathname.startsWith('/brand')) return 'brands';
  if (pathname.startsWith('/cocreators')) return 'cocreators';
  if (pathname.startsWith('/rrg') || pathname.startsWith('/shop') || pathname.startsWith('/drops')) return 'store';
  return undefined;
}

/** Render a single pass of marquee items with dot separators between them. */
function renderMarqueeRun(items: string[]) {
  return items.map((text, i) => (
    <Fragment key={`run-${i}-${text}`}>
      <span>{text}</span>
      <span className="dot">●</span>
    </Fragment>
  ));
}
