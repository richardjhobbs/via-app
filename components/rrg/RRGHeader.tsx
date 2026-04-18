'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LoginButton from './LoginButton';
import ThemeToggle from './ThemeToggle';

type NavKey = 'store' | 'brands' | 'concierge' | 'cocreators' | 'agent' | 'drops';

/**
 * RRGHeader — Maison topbar.
 *
 * Structure: announcement marquee above, then sticky topbar with
 * left nav / centered wordmark / right actions (Sign in + theme toggle).
 *
 * `active` can be passed explicitly; otherwise we derive it from the path.
 */
export default function RRGHeader({ active, showMarquee = true }: { active?: NavKey; showMarquee?: boolean }) {
  const pathname = usePathname() || '';
  const current = active ?? inferActive(pathname);

  return (
    <>
      {showMarquee && (
        <div className="marquee">
          <div className="marquee-track">
            <span>Store dispatch, Issue no. 04</span>
            <span className="dot">●</span>
            <span>Now admitting founding brands</span>
            <span className="dot">●</span>
            <span>Your concierge, quietly attentive, agent-ready</span>
            <span className="dot">●</span>
            <span>A fashion-first commerce platform</span>
            <span className="dot">●</span>
            <span>Brief open, Workshop Kiso, archival suede photo-essay</span>
            <span className="dot">●</span>
            <span>Store dispatch, Issue no. 04</span>
            <span className="dot">●</span>
            <span>Now admitting founding brands</span>
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <nav className="topbar-nav">
            <Link href="/rrg" className={current === 'store' ? 'is-active' : ''}>Store</Link>
            <Link href="/brand" className={current === 'brands' ? 'is-active' : ''}>Brands</Link>
            <Link href="/agents" className={current === 'concierge' ? 'is-active' : ''}>Concierge</Link>
            <Link href="/#cocreators" className={current === 'cocreators' ? 'is-active' : ''}>Co-creators</Link>
          </nav>

          <Link href="/" className="wordmark" style={{ textAlign: 'center', textDecoration: 'none', color: 'inherit' }}>
            Real Real Genuine
          </Link>

          <div className="topbar-right">
            <LoginButton />
            <ThemeToggle />
          </div>
        </div>
      </header>
    </>
  );
}

function inferActive(pathname: string): NavKey | undefined {
  if (pathname.startsWith('/agents')) return 'concierge';
  if (pathname.startsWith('/brand')) return 'brands';
  if (pathname.startsWith('/rrg') || pathname.startsWith('/shop') || pathname.startsWith('/drops')) return 'store';
  return undefined;
}
