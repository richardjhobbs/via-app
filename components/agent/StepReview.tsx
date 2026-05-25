'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TIER_DISPLAY } from '@/lib/agent/types';
import type { WizardState } from '@/lib/agent/types';
import { fetchJson, fetchErrorMessage } from '@/lib/util/fetchWithTimeout';

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

// Hard upper bound on a single create attempt. Past this we abort and
// surface a clear retry path; the spinner is never allowed to pin
// forever (see lib/util/fetchWithTimeout). Generous because ERC-8004
// minting is fire-and-forget but the synchronous Supabase round-trips
// can be slow on a cold VPS connection.
const CREATE_TIMEOUT_MS = 30_000;

// Threshold at which the "taking longer than expected" hint replaces
// the default helper text. Mid-deploy + slow Supabase round-trips can
// push the request past the stage indicator without it being broken.
const SLOW_HINT_MS = 8_000;

type ConflictPayload = {
  conflict?: 'email' | 'wallet';
  existing?: { id: string; name: string; tier: 'basic' | 'pro' };
  error?: string;
};

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
  const [conflict, setConflict] = useState<ConflictPayload['existing'] | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tierDisplay = TIER_DISPLAY[state.tier];

  // Advance the stage indicator while the create POST is in flight.
  // Caps at the final stage so we hold on "Preparing your dashboard"
  // if the request runs longer than the interval window. The hard
  // timeout in fetchJson ensures we never sit here forever.
  useEffect(() => {
    if (!loading) {
      setStageIndex(0);
      setSlowHint(false);
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
      return;
    }
    const id = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, CREATE_STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    slowTimerRef.current = setTimeout(() => setSlowHint(true), SLOW_HINT_MS);
    return () => {
      clearInterval(id);
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
    };
  }, [loading]);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    setConflict(null);

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

    const result = await fetchJson<{ agent: { id: string } }>('/api/agent/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: CREATE_TIMEOUT_MS,
    });

    setLoading(false);

    if (result.kind === 'ok') {
      onComplete(result.data.agent.id);
      return;
    }

    // Collision: the server identifies the existing agent so we can
    // route the user out cleanly instead of just shouting a string.
    if (result.kind === 'http' && result.status === 409) {
      const payload = result.body as ConflictPayload;
      if (payload?.existing) {
        setConflict(payload.existing);
        return;
      }
    }

    setError(fetchErrorMessage(result));
  };

  // Existing-account jump-out. We mint a fresh cookie via the session
  // endpoint (which already looks up by email and stamps via_agent_session)
  // then route to the dashboard. The dashboard's own bootstrap therefore
  // sees a valid cookie and skips its wallet-lookup fallback, so the
  // hand-off is clean even for someone who arrived in a new browser.
  const signInToExisting = async () => {
    setSigningIn(true);
    setError(null);
    const r = await fetchJson('/api/agent/session?email=' + encodeURIComponent(state.email), {
      method: 'GET',
      timeoutMs: 15_000,
    });
    setSigningIn(false);
    if (r.kind === 'ok') {
      router.push('/agents/dashboard');
    } else {
      // Last-resort: hard nav. The dashboard's wallet-fallback or its
      // own session check will pick up the trail if Thirdweb is still
      // connected; otherwise the user gets a clear "sign in" state.
      window.location.href = '/agents/dashboard';
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

      {conflict && (
        <div style={{
          marginBottom: 16,
          padding: 16,
          background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
          border: '1px solid var(--accent)',
          fontSize: 14,
          color: 'var(--ink)',
          lineHeight: 1.55,
        }}>
          <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-fraunces), serif', fontSize: 16 }}>
            Welcome back, {conflict.name}.
          </p>
          <p style={{ margin: '0 0 12px', color: 'var(--ink-2)', fontSize: 13 }}>
            You already have {conflict.tier === 'pro' ? 'a Concierge' : 'a Personal Shopper'} under this account.
            Sign in to your dashboard to keep going.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button onClick={signInToExisting} loading={signingIn}>
              Sign in to your dashboard
            </Button>
            <Button variant="ghost" onClick={onBack} disabled={signingIn}>
              Use a different email
            </Button>
          </div>
        </div>
      )}

      {error && !conflict && (
        <div style={{
          marginBottom: 16,
          padding: 14,
          background: 'color-mix(in srgb, #b5453a 8%, transparent)',
          border: '1px solid #b5453a',
          fontSize: 13,
          color: '#8a2e25',
          lineHeight: 1.55,
        }}>
          <p style={{ margin: '0 0 10px' }}>{error}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={handleCreate} size="sm">Try again</Button>
            <Button variant="ghost" onClick={onBack} size="sm">Back</Button>
          </div>
        </div>
      )}

      {loading ? (
        <CreateStages tierLabel={tierDisplay.label} stageIndex={stageIndex} slowHint={slowHint} />
      ) : !conflict ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="ghost" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button onClick={handleCreate} loading={loading}>
            Create {tierDisplay.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CreateStages({ tierLabel, stageIndex, slowHint }: { tierLabel: string; stageIndex: number; slowHint: boolean }) {
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
        fontSize: 11, color: slowHint ? '#8a2e25' : 'var(--ink-3)', margin: 0, lineHeight: 1.5,
      }}>
        {slowHint
          ? "Still working. If this doesn't finish in a moment, refresh and try again, we'll keep the details you entered."
          : 'Your wallet identity may take a few seconds to mint on Base. You can use the dashboard immediately, the VIA Agent ID will appear once linked.'}
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
