'use client';

/**
 * A slim top progress bar that shows a page is loading, not stuck. Most VIA
 * pages are force-dynamic server components, so a client transition waits on the
 * server render with no visual feedback. This bar starts the moment an internal
 * link is clicked and finishes when the new route paints, so navigation always
 * shows motion even while the server is working.
 *
 * Dependency-free: it intercepts internal-link clicks to start, and watches the
 * pathname/search for the completion. A start delay avoids a flash on instant
 * (cached) navigations, and a safety timeout means the bar can never stick.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);   // 0 = hidden
  const [visible, setVisible] = useState(false);

  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAll() {
    for (const r of [startTimer, safety, done]) if (r.current) { clearTimeout(r.current); r.current = null; }
    if (trickle.current) { clearInterval(trickle.current); trickle.current = null; }
  }

  function finish() {
    clearAll();
    setProgress(100);
    // Let the full bar render, then fade it out and reset.
    done.current = setTimeout(() => {
      setVisible(false);
      done.current = setTimeout(() => setProgress(0), 200);
    }, 180);
  }

  function begin() {
    clearAll();
    // Short delay: an instant navigation finishes before this fires, so the bar
    // never flashes for a same-tick transition.
    startTimer.current = setTimeout(() => {
      setVisible(true);
      setProgress(8);
      trickle.current = setInterval(() => {
        // Ease towards ~90% and wait there until the route actually paints.
        setProgress((p) => (p >= 90 ? p : p + Math.max(0.6, (90 - p) * 0.08)));
      }, 200);
      // The bar can never stick, even if a navigation is abandoned.
      safety.current = setTimeout(finish, 12000);
    }, 120);
  }

  // Start on any internal-link click (capture phase, so it runs before React).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;                 // external = real browser load
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page
      begin();
    }
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
  }, []);

  // The route finished painting: complete the bar.
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => clearAll, []);

  if (progress === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 2.5, zIndex: 2147483647,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--accent, #c9a477)',
          boxShadow: '0 0 8px var(--accent, #c9a477)',
          opacity: visible ? 1 : 0,
          transition: 'width 0.2s ease, opacity 0.25s ease',
        }}
      />
    </div>
  );
}
