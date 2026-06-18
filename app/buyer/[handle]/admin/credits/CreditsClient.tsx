'use client';

import { useState } from 'react';

export interface CreditTx {
  id: string;
  created_at: string;
  type: 'topup' | 'deduction' | 'refund';
  amount_usdc: number;
  balance_after: number;
  description: string | null;
  tx_hash: string | null;
}

interface Props {
  buyerId: string;
  walletAddress: string;
  platformWallet: string;
  initialCredits: number;
  initialHistory: CreditTx[];
}

const CREDITS_PER_USD = 1000;
const toCredits = (usd: number) => Math.round(usd * CREDITS_PER_USD);

export function CreditsClient({ buyerId, walletAddress, platformWallet, initialCredits, initialHistory }: Props) {
  const [credits, setCredits] = useState(initialCredits);
  const [history, setHistory] = useState<CreditTx[]>(initialHistory);
  const [txHash, setTxHash]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [copied, setCopied]   = useState(false);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hash = txHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || busy) { setErr('Enter a valid 0x… transaction hash (66 chars).'); return; }
    setErr(''); setOk(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/credits/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_hash: hash }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setCredits(json.credits);
      setOk(`Credited ${toCredits(json.credited).toLocaleString()} credits.`);
      setTxHash('');
      setHistory((h) => [{
        id: hash,
        created_at: new Date().toISOString(),
        type: 'topup',
        amount_usdc: json.credited,
        balance_after: json.new_balance,
        description: 'USDC top-up',
        tx_hash: hash,
      }, ...h]);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Balance */}
      <div className="bg-paper border border-line rounded-lg p-6">
        <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Balance</div>
        <div className="font-serif text-4xl tracking-tight">{credits.toLocaleString()} <span className="text-ink-3 text-2xl">credits</span></div>
        <div className="text-xs text-ink-3 mt-1">{(credits / CREDITS_PER_USD).toFixed(2)} USD · 1,000 credits = 1 USD</div>
      </div>

      {/* Top up */}
      <div className="bg-paper border border-line rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm font-medium mb-1">Top up with USDC</h2>
          <p className="text-sm text-ink-2">
            Send USDC on <strong>Base</strong> from your wallet
            {walletAddress ? <> (<code className="font-mono text-xs">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</code>)</> : null}
            {' '}to the platform wallet below, then paste the transaction hash to credit your balance. 1 USDC = 1,000 credits.
          </p>
        </div>

        {platformWallet ? (
          <div>
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Platform wallet (Base)</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm break-all bg-background border border-line-strong px-3 py-2 flex-1">{platformWallet}</code>
              <button type="button" onClick={() => copy(platformWallet)} className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink px-2 py-2 shrink-0">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[color:var(--danger)]">Platform wallet not configured , top-up is unavailable.</p>
        )}

        <form onSubmit={submit} className="space-y-3">
          <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block">Transaction hash</label>
          <input
            type="text" spellCheck={false} autoComplete="off"
            value={txHash} onChange={(e) => setTxHash(e.target.value)}
            placeholder="0x… (66 chars)"
            disabled={busy || !platformWallet}
            className="w-full bg-background border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink transition-colors disabled:opacity-50"
          />
          {err && <p className="text-xs text-[color:var(--danger)]">{err}</p>}
          {ok  && <p className="text-xs text-[color:var(--live)]">{ok}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !platformWallet || txHash.trim().length < 6}
              className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
            >
              {busy ? 'Verifying…' : 'Verify & credit'}
            </button>
          </div>
        </form>
      </div>

      {/* Ledger */}
      <div>
        <h2 className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-3">Recent activity</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-3">No credit activity yet.</p>
        ) : (
          <ul className="divide-y divide-line border border-line rounded-lg overflow-hidden">
            {history.map((t) => {
              const creditsDelta = toCredits(t.amount_usdc);
              const positive = creditsDelta >= 0;
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-paper">
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{t.description ?? t.type}</div>
                    <div className="text-[10px] font-mono text-ink-3">{new Date(t.created_at).toISOString().slice(0, 16).replace('T', ' ')}</div>
                  </div>
                  <div className={`font-mono text-sm shrink-0 ${positive ? 'text-[color:var(--live)]' : 'text-ink-2'}`}>
                    {positive ? '+' : ''}{creditsDelta.toLocaleString()}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
