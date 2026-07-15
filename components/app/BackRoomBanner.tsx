'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * A thin entry strip pointing an agent's owner to the Back Room, shown across
 * the agent dashboards so the room is reachable from every surface. It pulses
 * with a count when there is new activity (chat or table additions by others)
 * in any of the agent's rooms.
 */
export function BackRoomBanner({ href }: { href: string }) {
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch('/api/backroom/unseen')
      .then((r) => (r.ok ? r.json() : { unseen: 0 }))
      .then((j: { unseen?: number }) => { if (alive) setUnseen(j.unseen ?? 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="bg-background border-b border-line">
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between text-sm">
        <span className="text-ink-2 flex items-center">
          <span aria-hidden className="mr-2">🚪</span>
          The Back Room, make your taste card and meet people who think like you.
          {unseen > 0 && (
            <span className="br-pulse ml-2 inline-flex items-center justify-center rounded-full bg-danger text-white text-xs font-semibold px-2 py-0.5">
              {unseen} new
            </span>
          )}
        </span>
        <Link href={href} className="text-accent font-medium whitespace-nowrap hover:underline">
          Enter ↗
        </Link>
      </div>
    </div>
  );
}
