'use client';

import { useState } from 'react';

export interface MatchRow {
  id: string;
  title: string;
  seller_name: string;
  price_usdc: number | null;
  currency: string;
  product_url: string;
  source: string | null;
  created_at: string;
}

interface Props {
  buyerId: string;
  handle: string;
  matches: MatchRow[];
}

interface Settled {
  order_ref: string;
  amount_usdc: number;
  payment_tx_hash: string | null;
  mint_tx_hash: string | null;
  seller_usdc: number | null;
  reputation: { buyer: string | null; seller: string | null } | null;
}

type RowState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'confirm'; amount: number; seller: string }
  | { phase: 'settled'; receipt: Settled }
  | { phase: 'message'; text: string };

const isTxHash = (h: string | null): h is string => !!h && /^0x[0-9a-fA-F]{64}$/.test(h);
const txUrl = (h: string) => `https://basescan.org/tx/${h}`;

function priceLabel(m: MatchRow): string {
  if (m.price_usdc === null) return 'price on request';
  return `${Number(m.price_usdc).toFixed(2)} ${m.currency}`;
}

export function MatchesClient({ buyerId, handle, matches }: Props) {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const setRow = (id: string, s: RowState) => setStates((prev) => ({ ...prev, [id]: s }));

  async function purchase(m: MatchRow, confirm: boolean) {
    setRow(m.id, { phase: 'working' });
    try {
      const res = await fetch(`/api/buyer/${buyerId}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: m.id, confirm }),
      });
      const j = await res.json().catch(() => ({}));
      switch (j.status) {
        case 'needs_confirmation':
          setRow(m.id, { phase: 'confirm', amount: j.amount_usdc, seller: j.seller_name ?? m.seller_name });
          break;
        case 'settled':
          setRow(m.id, { phase: 'settled', receipt: j as Settled });
          break;
        case 'rejected':
        case 'unsupported':
          setRow(m.id, { phase: 'message', text: j.reason ?? 'Not available.' });
          break;
        default:
          setRow(m.id, { phase: 'message', text: j.message ?? `Failed (${res.status}).` });
      }
    } catch (e) {
      setRow(m.id, { phase: 'message', text: e instanceof Error ? e.message : 'Network error' });
    }
  }

  if (matches.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        No matches yet. <a href={`/buyer/${handle}/admin/intents`} className="underline hover:text-ink">Add a brief</a> to point your agent at what you want.
      </p>
    );
  }

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-2.5 border-b border-line text-[10px] font-mono tracking-widest uppercase text-ink-3">
        <span>Product</span><span className="text-right">Price</span>
      </div>
      <ul>
        {matches.map((m) => {
          const st = states[m.id] ?? { phase: 'idle' };
          const settlable = m.source === 'via' && m.price_usdc !== null;
          return (
            <li key={m.id} className="border-b border-line last:border-b-0">
              <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
                <span className="min-w-0">
                  <a href={m.product_url} target="_blank" rel="noreferrer" className="block text-sm text-ink hover:underline break-words">
                    {m.title}
                  </a>
                  <span className="block text-[11px] font-mono text-ink-3 mt-0.5">
                    {m.seller_name}{m.source && m.source !== 'via' ? ` · ${m.source.toUpperCase()}` : ''}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5 whitespace-nowrap">
                  <span className="text-sm tnum text-ink">{priceLabel(m)}</span>
                  {settlable && (st.phase === 'idle' || st.phase === 'message') && (
                    <button
                      type="button"
                      onClick={() => void purchase(m, false)}
                      className="text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded border border-line-strong hover:border-ink transition-colors"
                    >
                      Buy with agent
                    </button>
                  )}
                  {st.phase === 'working' && (
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">working…</span>
                  )}
                </span>
              </div>

              {/* Owner-confirm beat: the one human touch */}
              {st.phase === 'confirm' && (
                <div className="mx-4 mb-3 rounded-md border p-3" style={{ borderColor: 'var(--live)' }}>
                  <p className="text-sm text-ink">
                    Your agent is ready to buy <strong>{m.title}</strong> from {st.seller} for{' '}
                    <strong>${st.amount.toFixed(2)} USDC</strong> and settle it on-chain. Confirm?
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button type="button" onClick={() => void purchase(m, true)}
                      className="px-3 py-1.5 text-xs font-mono tracking-widest uppercase rounded-md text-background" style={{ background: 'var(--live)' }}>
                      Confirm &amp; settle
                    </button>
                    <button type="button" onClick={() => setRow(m.id, { phase: 'idle' })}
                      className="px-3 py-1.5 text-xs font-mono tracking-widest uppercase rounded-md border border-line-strong hover:border-ink transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Settled receipt: real on-chain proof */}
              {st.phase === 'settled' && (
                <div className="mx-4 mb-3 rounded-md border p-3 space-y-1.5" style={{ borderColor: 'var(--live)' }}>
                  <p className="text-sm text-ink">
                    Settled. <span className="font-mono text-ink-2">{st.receipt.order_ref}</span> · ${st.receipt.amount_usdc.toFixed(2)} USDC
                    {st.receipt.seller_usdc != null && <span className="text-ink-3"> · seller paid ${st.receipt.seller_usdc.toFixed(2)}</span>}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
                    {isTxHash(st.receipt.payment_tx_hash)
                      ? <a href={txUrl(st.receipt.payment_tx_hash)} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: 'var(--live)' }}>payment ↗</a>
                      : st.receipt.payment_tx_hash && <span className="text-ink-3">payment {st.receipt.payment_tx_hash}</span>}
                    {isTxHash(st.receipt.mint_tx_hash)
                      ? <a href={txUrl(st.receipt.mint_tx_hash)} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: 'var(--live)' }}>receipt mint ↗</a>
                      : st.receipt.mint_tx_hash && <span className="text-ink-3">mint {st.receipt.mint_tx_hash}</span>}
                    {st.receipt.reputation?.buyer && <span className="text-ink-3">reputation written</span>}
                  </div>
                </div>
              )}

              {st.phase === 'message' && (
                <p className="mx-4 mb-3 text-xs text-[color:var(--danger)]">{st.text}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
