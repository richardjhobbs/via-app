'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatCredits } from '@/lib/agent/credit-display';
import type { Agent } from '@/lib/agent/types';

interface Props {
  agent: Agent;
  onUpgraded: (next: Agent) => void;
}

/**
 * Personal Shopper → Concierge upgrade CTA.
 *
 * Rendered above the dashboard grid for tier='basic' agents only.
 * One-click upgrade; the existing credit balance carries over so the
 * 1,000-credit signup grant unlocks LLM chat instead of sitting idle.
 */
export function UpgradeToConcierge({ agent, onUpgraded }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const balance = Number(agent.credit_balance_usdc ?? 0);

  async function upgrade() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/agent/${agent.id}/upgrade`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error ?? 'Upgrade failed');
        return;
      }
      onUpgraded(data.agent);
    } catch {
      setErr('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      className="md:col-span-2"
      style={{
        border: '1px solid rgba(34, 197, 94, 0.35)',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))',
      }}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-green-600 mb-2">
            Concierge upgrade available
          </div>
          <h2 className="text-lg font-semibold mb-2">
            Unlock chat, memory, and tailored recommendations
          </h2>
          <p className="text-sm text-white/70 mb-3 max-w-xl">
            Your Personal Shopper runs on rules. Upgrade to Concierge to chat with your
            agent directly, get reasoned recommendations, generate an AI avatar, and have
            the assistant learn your taste over time.
          </p>
          {balance > 0 ? (
            <p className="text-xs text-green-700">
              Your existing balance of {formatCredits(balance)} carries over and powers chat the moment you upgrade.
            </p>
          ) : (
            <p className="text-xs text-white/50">
              Top up any time after upgrading to fund chat and tool use.
            </p>
          )}
        </div>

        <div className="flex flex-col items-stretch md:items-end gap-2 min-w-[180px]">
          {!confirming ? (
            <Button onClick={() => setConfirming(true)} disabled={busy}>
              Upgrade to Concierge
            </Button>
          ) : (
            <>
              <Button onClick={upgrade} loading={busy} disabled={busy}>
                Confirm upgrade
              </Button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
      </div>
    </Card>
  );
}
