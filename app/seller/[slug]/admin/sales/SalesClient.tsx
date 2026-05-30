'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type PurchaseStatus = 'pending' | 'paid' | 'minted' | 'paid_out' | 'failed';

interface Distribution {
  id:             string;
  seller_usdc:    number;
  platform_usdc:  number;
  split_type:     string;
  seller_tx_hash: string | null;
  status:         'pending' | 'paid' | 'failed';
  created_at:     string;
}

interface Product {
  title:    string;
  kind:     string;
  token_id: number | null;
}

interface Purchase {
  id:              string;
  order_ref:       string;
  product_id:      string;
  buyer_wallet:    string;
  buyer_agent_id:  string | null;
  qty:             number;
  total_usdc:      number;
  payment_method:  'x402_permit' | 'x402_operator';
  mint_tx_hash:    string | null;
  payout_tx_hash:  string | null;
  status:          PurchaseStatus;
  notes:           string | null;
  created_at:      string;
  updated_at:      string;
  product:         Product | null;
  distribution:    Distribution[] | null;
}

interface Stats {
  total_purchases:           number;
  by_status:                 Record<PurchaseStatus, number>;
  gross_usdc:                number;
  seller_usdc_paid_out:      number;
  platform_usdc_retained:    number;
}

interface Props {
  sellerId:      string;
  sellerSlug:    string;
  payoutWallet:  string;
}

const STATUS_FILTERS: { value: '' | PurchaseStatus; label: string }[] = [
  { value: '',         label: 'All' },
  { value: 'pending',  label: 'Pending' },
  { value: 'paid',     label: 'Paid' },
  { value: 'minted',   label: 'Minted' },
  { value: 'paid_out', label: 'Paid out' },
  { value: 'failed',   label: 'Failed' },
];

function truncWallet(w: string | null | undefined): string {
  if (!w) return '-';
  const s = String(w);
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function fmtUsdc(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

const BASESCAN = 'https://basescan.org/tx/';

function StatusBadge({ s }: { s: PurchaseStatus }) {
  const map: Record<PurchaseStatus, string> = {
    pending:  'bg-paper text-ink-2',
    paid:     'bg-[color:var(--accent)]/15 text-[color:var(--accent)]',
    minted:   'bg-[color:var(--warning)]/15 text-[color:var(--warning)]',
    paid_out: 'bg-[color:var(--live)]/15 text-[color:var(--live)]',
    failed:   'bg-[color:var(--danger)]/15 text-[color:var(--danger)]',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded ${map[s] ?? 'bg-paper'}`}>
      {s.replace('_', ' ')}
    </span>
  );
}

export function SalesClient({ sellerId, sellerSlug, payoutWallet }: Props) {
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [rows,      setRows]      = useState<Purchase[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState('');
  const [filter,    setFilter]    = useState<'' | PurchaseStatus>('');

  async function refresh() {
    setErr('');
    setLoading(true);
    try {
      const qs  = filter ? `?status=${filter}` : '';
      const res = await fetch(`/api/seller/${sellerId}/sales${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Load failed (${res.status})`);
        return;
      }
      setStats(json.stats ?? null);
      setRows(json.purchases ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId, filter]);

  const netRetainedHint = useMemo(() => {
    if (!stats) return '';
    return `97.5% of every paid-out sale lands at ${truncWallet(payoutWallet)}; the platform retains 2.5%.`;
  }, [stats, payoutWallet]);

  return (
    <div className="space-y-8">
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total sales"
          value={stats ? String(stats.total_purchases) : '-'}
          sub={
            stats && stats.total_purchases > 0
              ? Object.entries(stats.by_status)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${n} ${k.replace('_', ' ')}`)
                  .join(' · ')
              : 'No purchases yet.'
          }
        />
        <StatCard
          label="Gross (USDC)"
          value={stats ? fmtUsdc(stats.gross_usdc) : '-'}
          sub="Sum across every purchase row, any status."
        />
        <StatCard
          label="Paid out to you"
          value={stats ? fmtUsdc(stats.seller_usdc_paid_out) : '-'}
          sub="97.5% share, only paid distributions."
        />
        <StatCard
          label="Platform retained"
          value={stats ? fmtUsdc(stats.platform_usdc_retained) : '-'}
          sub="2.5% share."
        />
      </div>

      <p className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
        {netRetainedHint}
      </p>

      {err && (
        <div className="bg-[color:var(--danger)]/10 border border-[color:var(--danger)] text-[color:var(--danger)] text-sm rounded-md px-4 py-3">
          {err}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Filter</span>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded border transition-colors ${
              filter === f.value
                ? 'bg-ink text-background border-ink'
                : 'bg-paper text-ink-2 border-line-strong hover:border-ink'
            }`}
          >
            {f.label}
            {f.value && stats && stats.by_status[f.value as PurchaseStatus] > 0 && (
              <span className="ml-1.5 opacity-70">({stats.by_status[f.value as PurchaseStatus]})</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto text-[10px] font-mono uppercase tracking-widest text-ink-3 hover:text-ink"
        >
          Refresh
        </button>
      </div>

      {/* Rows */}
      {loading ? (
        <p className="text-sm text-ink-3">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <div className="bg-paper border border-line rounded-lg p-8 text-center">
          <p className="text-sm text-ink-2 mb-2">
            {filter
              ? `No ${filter.replace('_', ' ')} purchases yet.`
              : 'No purchases yet. Once a buying agent calls buy_product on your MCP and settles via x402, the rows land here.'}
          </p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
            Watching <code className="font-mono">app_purchases</code> + <code className="font-mono">app_distributions</code> for this seller.
          </p>
        </div>
      ) : (
        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs font-mono uppercase tracking-widest text-ink-3">
              <tr>
                <th className="text-left px-4 py-3">Order</th>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Buyer</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3">Gross (USDC)</th>
                <th className="text-right px-4 py-3">You receive</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">On-chain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {rows.map((r) => {
                const distro = r.distribution && r.distribution.length > 0 ? r.distribution[0] : null;
                return (
                  <tr key={r.id} className="hover:bg-paper">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/seller/${sellerSlug}/admin/orders/${r.order_ref}`}
                        className="text-ink underline hover:no-underline"
                      >
                        {r.order_ref}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-2 font-mono text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{r.product?.title ?? '(deleted product)'}</div>
                      <div className="text-[10px] font-mono text-ink-3">
                        {r.product?.kind ?? ''}{r.product?.token_id != null ? ` · token #${r.product.token_id}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-2" title={r.buyer_wallet}>
                      {truncWallet(r.buyer_wallet)}
                      {r.buyer_agent_id && (
                        <div className="text-[10px] text-ink-3">agent {r.buyer_agent_id}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{r.qty}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtUsdc(r.total_usdc)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {distro ? fmtUsdc(distro.seller_usdc) : <span className="text-ink-3">-</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge s={r.status} /></td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {r.mint_tx_hash && (
                        <div>
                          <a
                            href={`${BASESCAN}${r.mint_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ink underline hover:no-underline"
                          >
                            mint &nearr;
                          </a>
                        </div>
                      )}
                      {distro?.seller_tx_hash && (
                        <div>
                          <a
                            href={`${BASESCAN}${distro.seller_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[color:var(--live)] underline hover:no-underline"
                          >
                            payout &nearr;
                          </a>
                        </div>
                      )}
                      {!r.mint_tx_hash && !distro?.seller_tx_hash && (
                        <span className="text-ink-3">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] font-mono text-ink-3 leading-relaxed">
        Status flow: <code>pending</code> &rarr; <code>paid</code> (x402 settled) &rarr; <code>minted</code>{' '}
        (ERC-1155 operatorMint fired) &rarr; <code>paid_out</code> (97.5% USDC sent to your payout wallet).
      </p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-paper border border-line rounded-lg p-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-1">{label}</p>
      <p className="text-2xl font-serif tracking-tight text-ink mb-1">{value}</p>
      <p className="text-[10px] font-mono text-ink-3 leading-relaxed">{sub}</p>
    </div>
  );
}
