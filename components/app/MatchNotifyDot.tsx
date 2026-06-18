'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Flashing new-results indicator for the buyer top nav. Polls the buyer's
 * unseen match count every 60s and renders a pulsing dot when there are new
 * results (RRG nav-unread-dot parity). Silent on error / 0 / 401.
 */
export default function MatchNotifyDot({ buyerId }: { buyerId: string }) {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const r = await fetch(`/api/buyer/${buyerId}/matches/unread-count`, { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as { count?: number };
        if (!cancelled) setCount(typeof data.count === 'number' ? data.count : 0);
      } catch {
        // silent: keep last known count
      }
    };
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [buyerId, pathname]);

  if (count <= 0) return null;
  return <span className="nav-unread-dot" aria-label={`${count} new ${count === 1 ? 'result' : 'results'}`} title={`${count} new`} />;
}
