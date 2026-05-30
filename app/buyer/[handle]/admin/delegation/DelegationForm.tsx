'use client';

import { useState } from 'react';

interface Caps {
  max_purchase_usd?: number;
  auto_buy_under_usd?: number;
  categories_allowed?: string[];
  categories_blocked?: string[];
}

interface Props {
  buyerId: string;
  initialCaps: Caps;
}

export function DelegationForm({ buyerId, initialCaps }: Props) {
  const [maxPurchase, setMaxPurchase] = useState(
    initialCaps.max_purchase_usd !== undefined ? String(initialCaps.max_purchase_usd) : '',
  );
  const [autoBuy, setAutoBuy] = useState(
    initialCaps.auto_buy_under_usd !== undefined ? String(initialCaps.auto_buy_under_usd) : '',
  );
  const [allowed, setAllowed] = useState((initialCaps.categories_allowed ?? []).join(', '));
  const [blocked, setBlocked] = useState((initialCaps.categories_blocked ?? []).join(', '));

  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [msg, setMsg]   = useState('');

  function splitCsv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      const payload = {
        max_purchase_usd:   maxPurchase.trim() === '' ? null : Number(maxPurchase),
        auto_buy_under_usd: autoBuy.trim() === '' ? null : Number(autoBuy),
        categories_allowed: splitCsv(allowed),
        categories_blocked: splitCsv(blocked),
      };
      const res = await fetch(`/api/buyer/${buyerId}/delegation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Failed (${res.status})`);
        return;
      }
      setMsg('Caps saved.');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full bg-paper border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink transition-colors disabled:opacity-50';

  return (
    <form onSubmit={save} className="bg-paper border border-line rounded-lg p-5 space-y-5">
      <div>
        <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">
          Max purchase (USD)
        </label>
        <p className="text-xs text-ink-3 mb-2">The most your agent may commit to a single order. Leave blank for no ceiling.</p>
        <input type="number" min="0" step="0.01" value={maxPurchase} onChange={(e) => setMaxPurchase(e.target.value)} disabled={busy} className={inputClass} placeholder="e.g. 500" />
      </div>

      <div>
        <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">
          Auto-buy under (USD)
        </label>
        <p className="text-xs text-ink-3 mb-2">Orders below this may be accepted without asking you. Anything above queues for your approval.</p>
        <input type="number" min="0" step="0.01" value={autoBuy} onChange={(e) => setAutoBuy(e.target.value)} disabled={busy} className={inputClass} placeholder="e.g. 50" />
      </div>

      <div>
        <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">
          Categories allowed
        </label>
        <p className="text-xs text-ink-3 mb-2">Comma-separated. When set, your agent only pursues these. Leave blank to allow everything except blocked.</p>
        <input type="text" value={allowed} onChange={(e) => setAllowed(e.target.value)} disabled={busy} className={inputClass} placeholder="electronics, books, coffee" />
      </div>

      <div>
        <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">
          Categories blocked
        </label>
        <p className="text-xs text-ink-3 mb-2">Comma-separated. Your agent always refuses these.</p>
        <input type="text" value={blocked} onChange={(e) => setBlocked(e.target.value)} disabled={busy} className={inputClass} placeholder="alcohol, tobacco" />
      </div>

      {err && <p className="text-sm text-[color:var(--danger)]">{err}</p>}
      {msg && <p className="text-sm text-[color:var(--live)]">{msg}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-3 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 transition-colors rounded-md"
        >
          {busy ? 'Saving…' : 'Save caps'}
        </button>
      </div>
    </form>
  );
}
