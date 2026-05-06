'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { Agent } from '@/lib/agent/types';

interface Props {
  agent: Agent;
  onClose: () => void;
  onCredited: (newBalance: number) => void;
}

const lbl: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--ink-3)',
};
const body: React.CSSProperties = { fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 };

export function TopUpModal({ agent, onClose, onCredited }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credited, setCredited] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    setSyncing(true);
    setError(null);
    setCredited(null);
    try {
      const res = await fetch(`/api/agent/${agent.id}/credits/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sync failed');
        return;
      }
      setCredited(data.credited);
      if (data.credited > 0) {
        setTimeout(() => onCredited(data.credit_balance), 1200);
      } else {
        // No new inbound yet — keep modal open so user can wait + retry.
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(agent.wallet_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--ink) 55%, transparent)',
        backdropFilter: 'blur(6px)',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line-strong)',
          width: '100%', maxWidth: 460,
          padding: 28,
          color: 'var(--ink)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
            Top up balance
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 18, padding: 0 }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={lbl}>Current balance</div>
          <div style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontSize: 32, fontWeight: 300, letterSpacing: '-0.02em',
            color: 'var(--accent)', marginTop: 4,
          }}>
            ${Number(agent.credit_balance_usdc ?? 0).toFixed(2)}
          </div>
        </div>

        {error && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: 'color-mix(in srgb, #b5453a 8%, transparent)',
            border: '1px solid #b5453a',
            fontSize: 12,
            color: '#8a2e25',
          }}>
            {error}
          </div>
        )}

        {credited !== null && credited > 0 && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            border: '1px solid var(--accent)',
            fontSize: 12,
            color: 'var(--ink)',
          }}>
            Credited ${credited.toFixed(2)}.
          </div>
        )}

        {credited === 0 && !error && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--ink-2)',
          }}>
            No new deposits detected yet. Allow ~30s after sending, then refresh.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={body}>
            Send any amount of USDC on Base to your Concierge wallet. Your balance updates within ~30s of the transfer confirming.
          </p>

          <div>
            <div style={lbl}>Your Concierge wallet</div>
            <div style={{
              marginTop: 6,
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              padding: 12,
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: 11, color: 'var(--ink-2)',
              wordBreak: 'break-all', userSelect: 'all',
            }}>
              {agent.wallet_address}
            </div>
            <button
              onClick={copyAddress}
              style={{
                marginTop: 6,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--ink-3)', fontSize: 11, padding: 0,
                fontFamily: 'var(--font-jetbrains), monospace',
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}
            >
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={refresh} loading={syncing}>
              I&apos;ve sent it, refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
