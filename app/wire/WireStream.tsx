'use client';

import { useEffect, useRef, useState } from 'react';
import type { WireEvent } from '@/lib/app/wire';

const MONO = 'var(--font-jetbrains), ui-monospace, monospace';

const DOT: Record<WireEvent['type'], string> = {
  intent: 'var(--ink-3)',
  offer: 'var(--accent)',
  settlement: '#3f7d4e',
};
const LABEL: Record<WireEvent['type'], string> = {
  intent: 'DEMAND',
  offer: 'OFFER',
  settlement: 'SETTLED',
};

function rel(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function usdc(n: number | null | undefined): string {
  if (typeof n !== 'number') return '';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 })} USDC`;
}

function Line({ e }: { e: WireEvent }) {
  if (e.type === 'intent') {
    const bits = [e.product_type, e.attribute].filter(Boolean).join(' · ');
    return (
      <>
        <span>An agent is looking for </span>
        <strong style={{ color: 'var(--ink)' }}>{bits || e.category || 'something'}</strong>
        {e.category && bits ? <span style={{ color: 'var(--ink-3)' }}> in {e.category}</span> : null}
      </>
    );
  }
  if (e.type === 'offer') {
    return (
      <>
        <strong style={{ color: 'var(--ink)' }}>{e.seller_name || 'A seller'}</strong>
        <span> offered </span>
        <span style={{ color: 'var(--ink-2)' }}>{e.title || 'a product'}</span>
        {typeof e.price_usdc === 'number' ? (
          <span style={{ fontFamily: MONO, color: 'var(--ink-2)' }}> · {usdc(e.price_usdc)}</span>
        ) : null}
        {e.fits ? <span style={{ color: '#3f7d4e' }}> · fits</span> : null}
      </>
    );
  }
  return (
    <>
      <span>Settled </span>
      <strong style={{ color: 'var(--ink)' }}>{e.title || 'an order'}</strong>
      {e.seller_name ? <span style={{ color: 'var(--ink-3)' }}> from {e.seller_name}</span> : null}
      {typeof e.amount_usdc === 'number' ? (
        <span style={{ fontFamily: MONO, color: 'var(--ink)' }}> · {usdc(e.amount_usdc)}</span>
      ) : null}
    </>
  );
}

export default function WireStream({
  initial,
  limit = 50,
  compact = false,
}: {
  initial: WireEvent[];
  limit?: number;
  compact?: boolean;
}) {
  const [events, setEvents] = useState<WireEvent[]>(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState<number>(() => Date.now());
  const seen = useRef<Set<string>>(new Set(initial.map((e) => e.id)));

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/via/wire?limit=${limit}`, { cache: 'no-store' });
        if (!res.ok) return;
        const j = (await res.json()) as { events?: WireEvent[] };
        const incoming = j.events ?? [];
        if (!alive) return;
        const isNew = incoming.filter((e) => !seen.current.has(e.id));
        if (isNew.length) {
          for (const e of incoming) seen.current.add(e.id);
          setFresh(new Set(isNew.map((e) => e.id)));
          setTimeout(() => alive && setFresh(new Set()), 2200);
        }
        setEvents(incoming);
        setNow(Date.now());
      } catch {
        /* transient , next tick retries */
      }
    }
    const poller = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void poll();
    }, 7000);
    const ticker = setInterval(() => alive && setNow(Date.now()), 15000);
    return () => {
      alive = false;
      clearInterval(poller);
      clearInterval(ticker);
    };
  }, [limit]);

  if (events.length === 0) {
    return (
      <p style={{ color: 'var(--ink-3)', fontSize: 15, padding: '32px 0' }}>
        The network is quiet right now. New demand and settlements appear here live.
      </p>
    );
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((e) => (
        <li
          key={e.id}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'baseline',
            padding: compact ? '9px 0' : '13px 2px',
            borderBottom: '1px solid var(--line)',
            fontSize: compact ? 13.5 : 15,
            lineHeight: 1.45,
            animation: fresh.has(e.id) ? 'wireIn 0.5s ease' : undefined,
          }}
        >
          <span
            aria-hidden
            style={{
              flex: 'none',
              width: 7,
              height: 7,
              marginTop: 6,
              borderRadius: '50%',
              background: DOT[e.type],
              boxShadow: fresh.has(e.id) ? `0 0 0 4px ${DOT[e.type]}22` : undefined,
            }}
          />
          <span
            style={{
              flex: 'none',
              width: 62,
              fontFamily: MONO,
              fontSize: 10.5,
              letterSpacing: '0.06em',
              color: DOT[e.type],
              textTransform: 'uppercase',
              paddingTop: 1,
            }}
          >
            {LABEL[e.type]}
          </span>
          <span style={{ flex: 1, color: 'var(--ink-2)', minWidth: 0 }}>
            <Line e={e} />
            {e.tx_url ? (
              <>
                {' '}
                <a
                  href={e.tx_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  Base ↗
                </a>
              </>
            ) : null}
          </span>
          <time
            dateTime={e.ts}
            style={{ flex: 'none', fontFamily: MONO, fontSize: 11.5, color: 'var(--ink-3)', paddingTop: 1 }}
          >
            {rel(e.ts, now)}
          </time>
        </li>
      ))}
      <style>{`@keyframes wireIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
    </ol>
  );
}
