'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Kind = 'enquiry' | 'sale' | 'transfer' | 'system';

interface Notification {
  id:         string;
  kind:       Kind;
  title:      string;
  body:       string | null;
  link:       string | null;
  metadata:   Record<string, unknown>;
  created_at: string;
  read_at:    string | null;
}

interface Payload {
  unread: number;
  recent: Notification[];
}

const POLL_MS = 30_000;

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60_000)   return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function kindBadgeClass(k: Kind): string {
  switch (k) {
    case 'enquiry':  return 'bg-sky-100 text-sky-900';
    case 'sale':     return 'bg-emerald-100 text-emerald-900';
    case 'transfer': return 'bg-amber-100 text-amber-900';
    case 'system':   return 'bg-neutral-200 text-neutral-700';
  }
}

function senderLine(meta: Record<string, unknown>): string | null {
  const ident   = (meta?.agent_identity ?? {}) as Record<string, unknown>;
  const viaId   = ident.via_agent_id;
  const ip      = (ident.ip as string | null | undefined) ?? null;
  const contact = (meta?.contact as string | null | undefined) ?? null;

  const parts: string[] = [];
  if (viaId !== null && viaId !== undefined && viaId !== '') {
    parts.push(`agent #${viaId}`);
  } else if (ip) {
    parts.push(ip);
  }
  if (contact) parts.push(`contact: ${contact}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function setAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?:   (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0 && typeof nav.setAppBadge === 'function') {
    void nav.setAppBadge(count).catch(() => {});
  } else if (count === 0 && typeof nav.clearAppBadge === 'function') {
    void nav.clearAppBadge().catch(() => {});
  }
}

export function NotificationBell() {
  const [open, setOpen]     = useState(false);
  const [data, setData]     = useState<Payload | null>(null);
  const [busy, setBusy]     = useState(false);
  const dropdownRef         = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const json: Payload = await res.json();
      setData(json);
      setAppBadge(json.unread);
    } catch {
      // Silent — bell stays at the last good count.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Close the dropdown when the user clicks outside it.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!dropdownRef.current) return;
      if (dropdownRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function markRead(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const unread = data?.unread ?? 0;
  const recent = data?.recent ?? [];
  const hasAny = recent.length > 0;

  const buttonLabel = useMemo(() => unread > 0 ? `Notifications (${unread} unread)` : 'Notifications', [unread]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        aria-label={buttonLabel}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-neutral-800 transition-colors"
      >
        {/* Bell glyph */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22Zm6.7-6.3-1.42-1.42a1 1 0 0 1-.28-.7V11a5 5 0 0 0-4-4.9V5.5a1 1 0 0 0-2 0V6.1A5 5 0 0 0 7 11v2.58a1 1 0 0 1-.29.7L5.3 15.7a1 1 0 0 0 .7 1.7h12a1 1 0 0 0 .7-1.7Z"
            fill="currentColor"
            className="text-neutral-200"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-neutral-900 text-[10px] font-mono font-semibold">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[92vw] bg-white border border-neutral-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={busy}
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {!hasAny ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-neutral-600 mb-1">No notifications yet.</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                Enquiries and sales from buying agents will land here.
              </p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-neutral-100">
              {recent.map((n) => {
                const unreadRow = n.read_at == null;
                const sender    = senderLine(n.metadata);
                const Row = (
                  <div className={`px-4 py-3 ${unreadRow ? 'bg-amber-50/60' : 'bg-white'} hover:bg-neutral-50 transition-colors`}>
                    <div className="flex items-start gap-2 mb-1">
                      <span className={`inline-block px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest rounded ${kindBadgeClass(n.kind)}`}>
                        {n.kind}
                      </span>
                      <span className="ml-auto text-[10px] font-mono text-neutral-400">{fmtRelative(n.created_at)}</span>
                    </div>
                    <p className={`text-sm ${unreadRow ? 'font-medium text-neutral-900' : 'text-neutral-700'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                        {n.body.length > 180 ? `${n.body.slice(0, 180)}…` : n.body}
                      </p>
                    )}
                    {sender && (
                      <p className="text-[10px] font-mono text-neutral-500 mt-1.5 truncate">
                        From {sender}
                      </p>
                    )}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => { if (unreadRow) void markRead(n.id); setOpen(false); }}
                        className="block"
                      >
                        {Row}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { if (unreadRow) void markRead(n.id); }}
                        className="block w-full text-left"
                      >
                        {Row}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
