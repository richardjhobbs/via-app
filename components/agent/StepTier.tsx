'use client';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { WizardState } from '@/lib/agent/types';

interface Props {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
  onNext: () => void;
}

const headingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-fraunces), serif',
  fontSize: 28,
  fontWeight: 300,
  letterSpacing: '-0.015em',
  margin: '0 0 10px',
  lineHeight: 1.15,
};

const subheadStyle: React.CSSProperties = {
  color: 'var(--ink-2)',
  fontSize: 15,
  lineHeight: 1.55,
  margin: '0 0 28px',
  fontWeight: 300,
  maxWidth: '52ch',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  fontSize: 14,
  color: 'var(--ink-2)',
  lineHeight: 1.8,
};

export function StepTier({ state, update, onNext }: Props) {
  const isPro = state.tier === 'pro';

  return (
    <div>
      <h2 style={headingStyle}>Choose your service.</h2>
      <p style={subheadStyle}>
        Start with a Personal Shopper that handles the basics for free.
        Upgrade to a Concierge that learns your taste, negotiates, and acts with judgement.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
        {/* Personal Shopper */}
        <div>
          <Card
            onClick={() => update({ tier: 'basic' })}
            style={{
              cursor: 'pointer',
              borderColor: !isPro ? 'var(--ink)' : 'var(--line)',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
                Personal Shopper
              </h3>
              <Badge>Free</Badge>
            </div>
            <ul style={listStyle}>
              <Bullet>Works on the preferences you set</Bullet>
              <Bullet>Finds, filters, and surfaces what matches</Bullet>
              <Bullet>Handles the browsing so you do not have to</Bullet>
              <Bullet>Dashboard and email notifications</Bullet>
              <Bullet>ERC-8004 on-chain identity</Bullet>
            </ul>
          </Card>
          {!isPro && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Button onClick={onNext}>
                Continue with Personal Shopper <span style={{ marginLeft: 6 }}>→</span>
              </Button>
            </div>
          )}
        </div>

        {/* Concierge */}
        <div>
          <Card
            onClick={() => update({ tier: 'pro' })}
            style={{
              cursor: 'pointer',
              borderColor: isPro ? 'var(--accent)' : 'var(--line)',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
                Concierge
              </h3>
              <Badge variant="pro">Credit-based</Badge>
            </div>
            <ul style={listStyle}>
              <Bullet>Learns and adapts to your evolving taste</Bullet>
              <Bullet>Understands nuance and context</Bullet>
              <Bullet>Negotiates on your behalf</Bullet>
              <Bullet>Chat with your Concierge directly</Bullet>
              <Bullet>Powered by Claude or DeepSeek</Bullet>
              <Bullet>Falls back to Personal Shopper when credits run out</Bullet>
            </ul>
          </Card>
          {isPro && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Button
                onClick={onNext}
                style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
              >
                Continue with Concierge <span style={{ marginLeft: 6 }}>→</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ paddingLeft: 14, position: 'relative' }}>
      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
      {children}
    </li>
  );
}
