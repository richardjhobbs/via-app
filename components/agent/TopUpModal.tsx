'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Agent } from '@/lib/agent/types';

const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

interface Props {
  agent: Agent;
  onClose: () => void;
  onCredited: (newBalance: number) => void;
}

type Step = 'choose' | 'wallet' | 'verifying' | 'success';

const lbl: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--ink-3)',
};
const body: React.CSSProperties = { fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 };

export function TopUpModal({ agent, onClose, onCredited }: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [credited, setCredited] = useState<number | null>(null);

  async function verifyTransaction() {
    if (!txHash.trim()) {
      setError('Please enter the transaction hash');
      return;
    }
    setStep('verifying');
    setError(null);

    try {
      const res = await fetch(`/api/agent/${agent.id}/credits/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_hash: txHash.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Verification failed');
        setStep('wallet');
        return;
      }

      setCredited(data.credited);
      setStep('success');
      setTimeout(() => onCredited(data.new_balance), 1500);
    } catch {
      setError('Connection error. Please try again.');
      setStep('wallet');
    }
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
            Top up Concierge Credits
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

        {step === 'choose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={body}>
              Concierge Credits power your chat conversations and drop evaluations.
              Charged based on actual token usage.
            </p>

            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--ink-3)' }}>Claude (Anthropic)</span>
                <span style={{ color: 'var(--ink)' }}>~$0.006 per message</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--ink-3)' }}>DeepSeek</span>
                <span style={{ color: 'var(--ink)' }}>~$0.001 per message</span>
              </div>
            </div>

            <button
              onClick={() => setStep('wallet')}
              style={{
                width: '100%',
                padding: 16, textAlign: 'left', cursor: 'pointer',
                background: 'transparent',
                border: '1px solid var(--line-strong)',
                color: 'var(--ink)', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ink)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
            >
              <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 16, fontWeight: 400, marginBottom: 4 }}>
                Top up with USDC
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Send USDC from your wallet on Base to add credits (1 USDC = $1.00 credit).
              </div>
            </button>

            <div style={{ textAlign: 'center' }}>
              <div style={{ ...lbl, color: 'var(--ink-3)', marginTop: 6 }}>Card payments coming soon</div>
            </div>
          </div>
        )}

        {step === 'wallet' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={body}>
              Send USDC on Base to the platform wallet. 1 USDC = $1.00 in Concierge Credits.
            </p>

            <div>
              <div style={lbl}>Platform wallet (send USDC here)</div>
              <div style={{
                marginTop: 6,
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                padding: 12,
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 11, color: 'var(--ink-2)',
                wordBreak: 'break-all', userSelect: 'all',
              }}>
                {PLATFORM_WALLET}
              </div>
            </div>

            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>Network: </span><span style={{ color: 'var(--ink)' }}>Base</span></div>
              <div style={{ fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>Token: </span><span style={{ color: 'var(--ink)' }}>USDC ({USDC_ADDRESS.slice(0, 8)}…)</span></div>
              <div style={{ fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>Rate: </span><span style={{ color: 'var(--ink)' }}>1 USDC = $1.00 credit</span></div>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <p style={{ ...body, fontSize: 12, marginBottom: 10 }}>
                After sending, paste the transaction hash below to verify and credit your account:
              </p>
              <Input
                label="Transaction hash"
                placeholder="0x..."
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => { setStep('choose'); setError(null); }}>
                Back
              </Button>
              <Button size="sm" onClick={verifyTransaction} disabled={!txHash.trim()}>
                Verify and credit
              </Button>
            </div>
          </div>
        )}

        {step === 'verifying' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ ...body, marginBottom: 6 }}>Verifying transaction on Base…</div>
            <div style={lbl}>Checking USDC transfer to platform wallet</div>
          </div>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: 40, color: 'var(--accent)', fontWeight: 300,
              marginBottom: 8, lineHeight: 1,
            }}>
              ✓
            </div>
            <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 18, color: 'var(--ink)', marginBottom: 4 }}>
              Credits added.
            </div>
            <div style={body}>
              ${credited?.toFixed(2)} credited to your Concierge.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
