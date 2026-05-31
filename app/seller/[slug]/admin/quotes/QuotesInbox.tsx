'use client';

import { useCallback, useEffect, useState } from 'react';

interface BreakdownLine { label: string; amount: number }
interface ThreadRound {
  round: number;
  by: 'agent' | 'buyer' | 'seller';
  total_usdc: number | null;
  note?: string | null;
  at: string;
}
interface Quote {
  id: string;
  quote_ref: string;
  product_id: string | null;
  product_title: string | null;
  buyer_agent_id: string | null;
  contact: string | null;
  status: string;
  proposed_total_usdc: number | null;
  approved_total_usdc: number | null;
  breakdown: BreakdownLine[];
  selections: { options?: Record<string, unknown>; quantity?: number } | null;
  spec: Record<string, unknown> | null;
  thread: ThreadRound[];
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending_seller_approval: 'Awaiting your approval',
  countered_by_buyer:      'Buyer countered',
  revised_by_seller:       'You revised',
  approved:                'Approved',
  rejected:                'Declined',
  expired:                 'Expired',
};

const OPEN_STATUSES = new Set(['pending_seller_approval', 'countered_by_buyer', 'revised_by_seller']);

function usd(n: number | null): string {
  return n == null ? 'n/a' : `${n.toFixed(2)} USDC`;
}

export default function QuotesInbox({ sellerId }: { sellerId: string }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviseValue, setReviseValue] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/seller/${sellerId}/quotes`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load quotes');
      setQuotes(json.quotes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load quotes');
    } finally {
      setLoading(false);
    }
  }, [sellerId]);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (
    quoteId: string,
    action: 'approve' | 'revise' | 'reject',
    total_usdc?: number,
  ) => {
    setBusyId(quoteId);
    setError(null);
    try {
      const res = await fetch(`/api/seller/${sellerId}/quotes/${quoteId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, total_usdc }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Decision failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setBusyId(null);
    }
  }, [sellerId, load]);

  if (loading) return <p className="text-sm text-ink-3 font-mono">Loading quotes…</p>;

  return (
    <div className="space-y-6">
      {error && (
        <div className="border border-line bg-background px-4 py-3 text-sm text-ink-2">{error}</div>
      )}
      {quotes.length === 0 && (
        <p className="text-sm text-ink-3">No quote requests yet. When a buying agent calls request_quote on a configurable product, it lands here.</p>
      )}

      {quotes.map((q) => {
        const open = OPEN_STATUSES.has(q.status);
        const current = q.status === 'approved' ? q.approved_total_usdc : q.proposed_total_usdc;
        return (
          <article key={q.id} className="border border-line">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
              <div>
                <p className="font-mono text-sm tracking-wide">{q.quote_ref}</p>
                <p className="text-sm text-ink-2 mt-0.5">{q.product_title ?? 'Custom order'}</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono tracking-widest uppercase text-ink-3">{STATUS_LABEL[q.status] ?? q.status}</span>
                <p className="font-serif text-xl mt-1">{usd(current)}</p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3 text-sm">
              {q.selections?.options && Object.keys(q.selections.options).length > 0 && (
                <div>
                  <p className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Configuration</p>
                  <ul className="text-ink-2">
                    {q.selections.quantity != null && <li>Quantity: {q.selections.quantity}</li>}
                    {Object.entries(q.selections.options).map(([k, v]) => (
                      <li key={k}>{k}: {Array.isArray(v) ? v.join(', ') : String(v)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {q.breakdown?.length > 0 && (
                <div>
                  <p className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Advisory breakdown</p>
                  <ul className="text-ink-2">
                    {q.breakdown.map((b, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{b.label}</span>
                        <span className="font-mono">{b.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {q.thread?.length > 0 && (
                <div>
                  <p className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Thread</p>
                  <ul className="text-ink-2 space-y-1">
                    {q.thread.map((r, i) => (
                      <li key={i}>
                        <span className="font-mono text-xs uppercase text-ink-3">{r.by}</span>
                        {r.total_usdc != null && <span> · {r.total_usdc.toFixed(2)} USDC</span>}
                        {r.note && <span> · {r.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(q.contact || q.buyer_agent_id) && (
                <p className="text-xs text-ink-3">
                  {q.buyer_agent_id && <>Agent #{q.buyer_agent_id}</>}
                  {q.buyer_agent_id && q.contact && ' · '}
                  {q.contact && <>Reach back: {q.contact}</>}
                </p>
              )}
            </div>

            {open && (
              <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-t border-line">
                <button
                  disabled={busyId === q.id}
                  onClick={() => decide(q.id, 'approve')}
                  className="text-xs font-mono tracking-widest uppercase px-4 py-2 bg-ink text-background hover:opacity-90 transition disabled:opacity-50"
                >
                  Approve {usd(q.proposed_total_usdc)}
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="New price"
                    value={reviseValue[q.id] ?? ''}
                    onChange={(e) => setReviseValue((s) => ({ ...s, [q.id]: e.target.value }))}
                    className="w-28 border border-line bg-background px-2 py-1.5 text-sm"
                  />
                  <button
                    disabled={busyId === q.id || !reviseValue[q.id]}
                    onClick={() => decide(q.id, 'revise', parseFloat(reviseValue[q.id]))}
                    className="text-xs font-mono tracking-widest uppercase px-4 py-2 border border-line hover:bg-ink hover:text-background transition disabled:opacity-50"
                  >
                    Revise
                  </button>
                </div>

                <button
                  disabled={busyId === q.id}
                  onClick={() => decide(q.id, 'reject')}
                  className="text-xs font-mono tracking-widest uppercase px-4 py-2 border border-line text-ink-3 hover:text-ink transition disabled:opacity-50 ml-auto"
                >
                  Decline
                </button>
              </div>
            )}

            {q.status === 'approved' && q.valid_until && (
              <div className="px-5 py-3 border-t border-line text-xs text-ink-3">
                Binding until {new Date(q.valid_until).toISOString().slice(0, 10)}.
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
