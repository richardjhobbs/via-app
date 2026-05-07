'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TIER_DISPLAY } from '@/lib/agent/types';
import type { WizardState } from '@/lib/agent/types';

interface Props {
  state: WizardState;
  onBack: () => void;
  onComplete: (agentId: string) => void;
  agentId: string | null;
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

export function StepReview({ state, onBack, onComplete, agentId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tierDisplay = TIER_DISPLAY[state.tier];

  const handleCreate = async () => {
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        email: state.email,
        name: state.name,
        tier: state.tier,
        style_tags: state.style_tags,
        free_instructions: state.free_instructions || null,
        budget_ceiling_usdc: state.budget_ceiling_usdc ? parseFloat(state.budget_ceiling_usdc) : null,
        bid_aggression: state.bid_aggression,
        llm_provider: state.llm_provider,
        wallet_address: state.wallet_address,
        wallet_type: state.wallet_type,
        persona_bio: state.persona_bio || null,
        persona_voice: state.persona_voice || null,
        persona_comm_style: state.persona_comm_style || null,
        interest_categories: state.interest_categories,
        loved_brands: state.loved_brands,
        avoided_brands: state.avoided_brands,
        sizes: state.sizes,
      };

      const res = await fetch('/api/agent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to create ${tierDisplay.label}`);
      }

      const { agent } = await res.json();
      onComplete(agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (agentId) {
    return (
      <div style={{ textAlign: 'center', padding: '56px 0' }}>
        <div style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: 56,
          color: 'var(--accent)',
          fontWeight: 300,
          lineHeight: 1,
          marginBottom: 20,
        }}>✓</div>
        <h2 style={{ ...headingStyle, textAlign: 'center', marginBottom: 12 }}>
          {tierDisplay.label} created.
        </h2>
        <p style={{ ...subheadStyle, textAlign: 'center', margin: '0 auto 10px', maxWidth: '46ch' }}>
          Your {tierDisplay.label} <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{state.name}</strong> is ready.
        </p>
        <p style={{
          fontSize: 13,
          color: 'var(--ink-3)',
          margin: '0 auto 28px',
          maxWidth: '48ch',
          lineHeight: 1.55,
          fontWeight: 300,
        }}>
          A VIA Agent ID will be assigned when your on-chain identity is linked.
          This is your portable identity across the VIA network.
        </p>
        <Button onClick={() => router.push('/agents/dashboard')}>
          Go to dashboard <span style={{ marginLeft: 6 }}>→</span>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h2 style={headingStyle}>Review and create.</h2>
      <p style={subheadStyle}>
        Confirm your {tierDisplay.label} configuration.
      </p>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 14 }}>
          <Row label="Service">
            <Badge variant={state.tier === 'pro' ? 'pro' : 'default'}>
              {tierDisplay.label}
            </Badge>
          </Row>
          <Row label="Name">{state.name}</Row>
          <Row label="Email">{state.email}</Row>
          <Row label="Wallet">
            {state.wallet_type === 'embedded'
              ? 'New embedded wallet (Thirdweb)'
              : `Imported: ${state.wallet_address.slice(0, 8)}...${state.wallet_address.slice(-6)}`}
          </Row>
          {state.loved_brands.length > 0 && (
            <Row label="Brands you love">{state.loved_brands.join(', ')}</Row>
          )}
          {state.avoided_brands.length > 0 && (
            <Row label="Brands you skip">{state.avoided_brands.join(', ')}</Row>
          )}
          {(state.sizes.tops || state.sizes.bottoms || state.sizes.shoes || state.sizes.sex || state.sizes.notes) && (
            <Row label="Sizes">
              {[
                state.sizes.sex,
                state.sizes.tops && `tops ${state.sizes.tops}`,
                state.sizes.bottoms && `bottoms ${state.sizes.bottoms}`,
                state.sizes.shoes && `shoes ${state.sizes.shoes}`,
                state.sizes.notes,
              ].filter(Boolean).join(' · ')}
            </Row>
          )}
          {state.style_tags.length > 0 && (
            <Row label="Style tags">{state.style_tags.join(', ')}</Row>
          )}
          {state.free_instructions && (
            <Row label="Instructions">{state.free_instructions}</Row>
          )}
          {state.budget_ceiling_usdc && (
            <Row label="Budget ceiling">${state.budget_ceiling_usdc} USDC</Row>
          )}
          <Row label="Bid style">{state.bid_aggression}</Row>
          {state.tier === 'pro' && (
            <Row label="LLM provider">{state.llm_provider}</Row>
          )}
          {state.persona_bio && (
            <Row label="Persona bio">{state.persona_bio}</Row>
          )}
          {state.persona_voice && (
            <Row label="Voice">{state.persona_voice}</Row>
          )}
          {state.persona_comm_style && (
            <Row label="Communication">{state.persona_comm_style}</Row>
          )}
          {state.interest_categories.length > 0 && (
            <Row label="Interests">
              {state.interest_categories.map(ic => `${ic.category} (${ic.tags.length})`).join(', ')}
            </Row>
          )}
        </div>
      </Card>

      {error && (
        <div style={{
          marginBottom: 16,
          padding: 14,
          background: 'color-mix(in srgb, #b5453a 8%, transparent)',
          border: '1px solid #b5453a',
          fontSize: 13,
          color: '#8a2e25',
          lineHeight: 1.55,
        }}>
          {error}
          {(error.includes('already registered') || error.includes('already')) && (
            <div style={{ marginTop: 8 }}>
              <a
                href="/agents/dashboard"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                  paddingBottom: 1,
                }}
              >
                Go to your dashboard
              </a>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="ghost" onClick={onBack} disabled={loading}>
          Back
        </Button>
        <Button onClick={handleCreate} loading={loading}>
          Create {tierDisplay.label}
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, auto) 1fr',
      gap: 20,
      alignItems: 'flex-start',
      paddingBottom: 10,
      borderBottom: '1px dotted var(--line)',
    }}>
      <span style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        paddingTop: 2,
      }}>
        {label}
      </span>
      <span style={{ color: 'var(--ink)', textAlign: 'left', wordBreak: 'break-word' }}>
        {children}
      </span>
    </div>
  );
}
