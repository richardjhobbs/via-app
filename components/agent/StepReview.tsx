'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TIER_DISPLAY } from '@/lib/agent/types';
import type { WizardState } from '@/lib/agent/types';

// Stages the user sees while the create POST is in flight. Advances
// on a fixed cadence so there's visible progress; the actual API does
// these steps in roughly this order. If the response arrives early we
// jump straight to the success view; if it takes longer we hold on
// the last stage with a spinner.
const CREATE_STAGES = [
  'Saving your profile',
  'Seeding your taste memory',
  'Setting up your VIA wallet identity',
  'Preparing your dashboard',
] as const;
const STAGE_INTERVAL_MS = 800;

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
  const [stageIndex, setStageIndex] = useState(0);

  const tierDisplay = TIER_DISPLAY[state.tier];

  // Advance the stage indicator while the create POST is in flight.
  // Caps at the final stage so we hold on "Preparing your dashboard"
  // if the request runs longer than the interval window.
  useEffect(() => {
    if (!loading) {
      setStageIndex(0);
      return;
    }
    const id = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, CREATE_STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loading]);

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

      {loading ? (
        <CreateStages tierLabel={tierDisplay.label} stageIndex={stageIndex} />
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="ghost" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button onClick={handleCreate} loading={loading}>
            Create {tierDisplay.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function CreateStages({ tierLabel, stageIndex }: { tierLabel: string; stageIndex: number }) {
  return (
    <div style={{
      border: '1px solid var(--line)',
      background: 'var(--bg-2)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--ink-3)',
      }}>
        Creating your {tierLabel}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CREATE_STAGES.map((stage, i) => {
          const isDone = i < stageIndex;
          const isActive = i === stageIndex;
          return (
            <li
              key={stage}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                fontSize: 13,
                color: isDone ? 'var(--ink-2)' : isActive ? 'var(--ink)' : 'var(--ink-3)',
                opacity: isDone || isActive ? 1 : 0.5,
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, flexShrink: 0,
                fontSize: 11, fontWeight: 600,
                color: isDone ? 'var(--accent)' : isActive ? 'var(--ink)' : 'var(--ink-3)',
                border: isDone ? 'none' : '1px solid var(--line-strong)',
                borderRadius: 99,
                background: isDone ? 'transparent' : 'var(--paper)',
              }}>
                {isDone ? '✓' : isActive ? (
                  <span
                    aria-hidden
                    style={{
                      width: 8, height: 8, borderRadius: 99,
                      border: '1.5px solid var(--ink)',
                      borderTopColor: 'transparent',
                      animation: 'spin 0.9s linear infinite',
                    }}
                  />
                ) : ''}
              </span>
              <span>{stage}{isActive ? '…' : ''}</span>
            </li>
          );
        })}
      </ul>
      <p style={{
        fontSize: 11, color: 'var(--ink-3)', margin: 0, lineHeight: 1.5,
      }}>
        Your wallet identity may take a few seconds to mint on Base. You can use the dashboard immediately, the VIA Agent ID will appear once linked.
      </p>
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
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
