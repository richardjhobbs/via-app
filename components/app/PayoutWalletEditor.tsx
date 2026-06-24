'use client';

import { useState } from 'react';

/**
 * Payout wallet editor on the seller dashboard. app_sellers.wallet_address is
 * where USDC sales settle, and it doubles as a wallet the owner can sign with to
 * authenticate the store-management MCP. A store registered with a placeholder
 * (or a wallet the operator no longer holds) is otherwise stuck, so the owner
 * can repoint it to the real wallet here. The identity wallet is separate and
 * platform-managed; this only moves where money lands.
 */
const ADDRESS_RE  = /^0x[a-fA-F0-9]{40}$/;
const SENTINEL_RE = /^0x0{38}[0-9a-fA-F]{2}$/;

export default function PayoutWalletEditor({
  sellerId, initialWallet,
}: {
  sellerId: string;
  initialWallet: string;
}) {
  const [wallet, setWallet] = useState(initialWallet);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const trimmed   = wallet.trim();
  const formatOk  = ADDRESS_RE.test(trimmed);
  const sentinel  = SENTINEL_RE.test(trimmed);
  const valid     = formatOk && !sentinel;
  const changed   = trimmed.toLowerCase() !== initialWallet.trim().toLowerCase();

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/seller/${sellerId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: data.error || 'Could not save.' }); return; }
      setWallet(String(data.seller?.wallet_address ?? trimmed));
      setMsg({ ok: true, text: 'Saved. Future sales settle to this wallet, and you can sign with it to manage the store.' });
    } catch {
      setMsg({ ok: false, text: 'Could not save. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Payout wallet</h3>
        <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>where sales settle</div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', padding: '4px 2px 12px' }}>
        The Base wallet your USDC sales pay into. It is also a wallet you can sign with to authenticate
        store management over MCP, so set one you control. Changing it only moves where new payouts land.
      </p>

      <label className="block">
        <span className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>Wallet address</span>
        <input
          type="text" value={wallet} spellCheck={false} autoComplete="off"
          onChange={(e) => setWallet(e.target.value)}
          placeholder="0x…"
          style={{ width: '100%', background: 'var(--paper)', border: '1px solid var(--line-strong)', padding: '10px 12px', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-mono, monospace)' }}
        />
      </label>

      {trimmed.length > 0 && !formatOk && (
        <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>Not a valid EVM address (0x + 40 hex characters).</p>
      )}
      {sentinel && (
        <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>That is a placeholder/burn address. Use a real wallet you control.</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <button type="button" className="btn" onClick={save} disabled={saving || !valid || !changed}>
          {saving ? 'Saving…' : 'Save payout wallet'}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.ok ? 'var(--live)' : 'var(--danger)' }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
