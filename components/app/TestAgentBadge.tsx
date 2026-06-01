'use client';

import { useEffect, useState } from 'react';

/**
 * Live count of synthetic load-test buying agents, rendered in the footer nav.
 * Replaces the static "AGENT-READY" badge. Polls /api/stats/test-agents so the
 * footer reflects how many test agents are live during a stress run.
 *
 * Cosmetic today; may become a tracked network metric later.
 */
export default function TestAgentBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/stats/test-agents', { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as { count?: number };
        if (!cancelled && typeof data.count === 'number') setCount(data.count);
      } catch {
        // silent: keep last known value
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const label =
    count === null ? 'TEST AGENTS' : `${count} TEST AGENT${count === 1 ? '' : 'S'}`;

  return (
    <span className="via-foot-badge">
      <span className="d" /> {label}
    </span>
  );
}
