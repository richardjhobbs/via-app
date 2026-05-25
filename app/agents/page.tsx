'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';
import { Stepper } from '@/components/ui/Stepper';
import { StepRegistration } from '@/components/agent/StepRegistration';
import { StepProfile } from '@/components/agent/StepProfile';
import { StepReview } from '@/components/agent/StepReview';
import type { WizardState } from '@/lib/agent/types';
import { EMPTY_SIZE_PROFILE } from '@/lib/agent/types';
import { fetchJson } from '@/lib/util/fetchWithTimeout';

const initialState: WizardState = {
  // All new agents are Concierge. Basic tier is no longer offered (the
  // welcome credit puts every new user straight into Concierge from
  // signup), so the wizard hard-codes tier='pro'.
  tier: 'pro',
  email: '',
  name: '',
  wallet_address: '',
  wallet_type: 'embedded',
  style_tags: [],
  free_instructions: '',
  budget_ceiling_usdc: '',
  bid_aggression: 'balanced',
  // CAC programme is DeepSeek-only at signup. Server enforces this in
  // app/api/agent/create/route.ts; the wizard default just keeps state
  // consistent with what the server will save.
  llm_provider: 'deepseek',
  persona_bio: '',
  persona_voice: '',
  persona_comm_style: '',
  interest_categories: [],
  loved_brands: [],
  avoided_brands: [],
  sizes: { ...EMPTY_SIZE_PROFILE },
};

// Three wizard steps now that tier selection is removed (everyone is
// Concierge). The Stepper shows numbered progress; the indices below
// are 0-based and match the conditional render order in the JSX.
const WIZARD_STEPS = ['Register', 'Profile', 'Review'];

export default function AgentsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);

  const [wizardActive, setWizardActive] = useState(false);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [agentId, setAgentId] = useState<string | null>(null);

  const update = (partial: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...partial }));
  const next = () => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  const back = () => {
    if (step === 0) setWizardActive(false);
    else setStep((s) => Math.max(s - 1, 0));
  };

  // Session check with one retry on transient network failure. Previously
  // this caught all errors silently and dumped the user into the signup
  // wizard, which is catastrophic for an already-signed-up tester on a
  // flaky connection. We retry once after a short delay, and if it still
  // fails we surface a banner instead of guessing.
  useEffect(() => {
    let cancelled = false;
    const attempt = async (signal: AbortSignal) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10_000);
      signal.addEventListener('abort', () => ctl.abort(), { once: true });
      try {
        const res = await fetch('/api/agent/session', { signal: ctl.signal });
        clearTimeout(t);
        if (res.ok) return 'signed-in' as const;
        if (res.status === 401) return 'anonymous' as const;
        return 'error' as const;
      } catch {
        clearTimeout(t);
        return 'error' as const;
      }
    };
    const ctl = new AbortController();
    (async () => {
      let outcome = await attempt(ctl.signal);
      if (outcome === 'error' && !cancelled) {
        await new Promise((r) => setTimeout(r, 1_000));
        outcome = await attempt(ctl.signal);
      }
      if (cancelled) return;
      if (outcome === 'signed-in') {
        router.push('/agents/dashboard');
        return;
      }
      if (outcome === 'error') setSessionCheckFailed(true);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [router]);

  function startSignup() {
    setStep(0);
    setWizardActive(true);
  }

  // Email-only sign-in for returning users. Hits the session lookup
  // (which mints the cookie when it finds the agent) and routes to the
  // dashboard. Bounded fetch so a hang can't trap the user.
  const [signInEmail, setSignInEmail] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  async function signInWithEmail(e?: React.FormEvent) {
    e?.preventDefault();
    const email = signInEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setSignInError('Enter the email you signed up with.');
      return;
    }
    setSignInBusy(true);
    setSignInError(null);
    const r = await fetchJson('/api/agent/session?email=' + encodeURIComponent(email), {
      timeoutMs: 15_000,
    });
    setSignInBusy(false);
    if (r.kind === 'ok') {
      router.push('/agents/dashboard');
      return;
    }
    if (r.kind === 'http' && r.status === 401) {
      setSignInError("We couldn't find an agent with that email. Sign up below.");
      return;
    }
    setSignInError('Sign in is having trouble. Try again, or sign up below.');
  }

  if (checking) {
    return (
      <>
        <RRGHeader active="concierge" />
        <main className="page-pad">
          <p style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Checking your session…</p>
        </main>
        <RRGFooter />
      </>
    );
  }

  return (
    <>
      <RRGHeader active="concierge" />
      <main className="page-pad" style={{ maxWidth: 1200 }}>
        {sessionCheckFailed && !wizardActive && (
          <div style={{
            margin: '16px 0 0',
            padding: 14,
            background: 'color-mix(in srgb, #b5453a 6%, transparent)',
            border: '1px solid #b5453a',
            fontSize: 13,
            color: '#8a2e25',
            lineHeight: 1.55,
          }}>
            Couldn&rsquo;t check whether you&rsquo;re already signed in. If you have an existing
            Personal Shopper or Concierge, refresh this page or open your{' '}
            <a href="/agents/dashboard" style={{ color: '#8a2e25', borderBottom: '1px solid #8a2e25' }}>dashboard</a>.
            Otherwise carry on with a fresh signup below.
          </div>
        )}
        {!wizardActive ? (
          <>
            {/* ── Hero intro ──────────────────────────────── */}
            <div style={{ paddingTop: 24, paddingBottom: 40, borderBottom: '1px solid var(--line)', marginBottom: 48 }}>
              <div className="section-note" style={{ marginBottom: 8 }}>§ Your concierge</div>
              <h1 style={{
                fontFamily: 'var(--font-fraunces), serif',
                fontVariationSettings: '"opsz" 144, "wght" 300',
                fontSize: 'clamp(40px, 5.2vw, 72px)',
                letterSpacing: '-0.025em',
                lineHeight: 1.02,
                margin: '0 0 20px',
                color: 'var(--ink)',
              }}>
                Your <em>Concierge.</em>
              </h1>
              <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.65, maxWidth: '62ch', fontWeight: 300 }}>
                An AI agent that learns your taste, finds what matches on Real Real
                Genuine, and acts with judgement on your behalf. You set the rules.
                It does the work.
              </p>
            </div>

            {/* ── Single Concierge offer ─────────────────── */}
            <div className="collab-inner" style={{ padding: 0, marginBottom: 40 }}>
              <button
                type="button"
                onClick={startSignup}
                className="collab-card"
                style={{ textAlign: 'left', background: 'var(--paper)', cursor: 'pointer', minHeight: 420, borderColor: 'var(--accent)' }}
              >
                <div>
                  <h4><em>Concierge.</em></h4>
                  <p>
                    Learns your taste, understands nuance, and acts on your behalf.
                    The relationship deepens with every conversation.
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.8 }}>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Chat with your Concierge directly
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Learns your style over time
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Reasoned recommendations with explanations
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      A wallet and an on-chain VIA identity (ERC-8004)
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Welcome credit included, top up any time
                    </li>
                  </ul>
                </div>
                <div className="c-cta">
                  <span className="btn accent" style={{ padding: '12px 20px', fontSize: 12 }}>
                    Get started <span className="arrow">→</span>
                  </span>
                </div>
              </button>
            </div>

            {/* Returning? email-only sign-in */}
            <form
              onSubmit={signInWithEmail}
              style={{
                marginTop: 40,
                padding: '24px 28px',
                background: 'var(--paper)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
              }}
            >
              <div className="uc-mono" style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: '0.14em', marginBottom: 6 }}>
                Returning?
              </div>
              <div style={{ fontSize: 16, color: 'var(--ink)', lineHeight: 1.4, marginBottom: 14 }}>
                Sign in with the email you used at signup. Works on any device.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch' }}>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={signInEmail}
                  onChange={(e) => { setSignInEmail(e.target.value); setSignInError(null); }}
                  disabled={signInBusy}
                  style={{
                    flex: '1 1 240px',
                    minWidth: 0,
                    padding: '10px 12px',
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 13,
                    background: 'var(--bg)',
                    border: '1px solid var(--line-strong)',
                    color: 'var(--ink)',
                  }}
                />
                <button
                  type="submit"
                  disabled={signInBusy}
                  className="btn accent"
                  style={{ fontSize: 12, padding: '10px 20px', letterSpacing: '0.08em', opacity: signInBusy ? 0.7 : 1 }}
                >
                  {signInBusy ? 'Signing you in...' : <>Continue <span className="arrow">→</span></>}
                </button>
              </div>
              {signInError && (
                <p style={{ marginTop: 10, fontSize: 12, color: '#8a2e25', fontFamily: 'var(--font-jetbrains), monospace', letterSpacing: '0.04em' }}>
                  {signInError}
                </p>
              )}
            </form>
          </>
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <Stepper steps={WIZARD_STEPS} currentStep={step} />
            {step === 0 && (
              <StepRegistration state={state} update={update} onNext={next} onBack={back} />
            )}
            {step === 1 && (
              <StepProfile state={state} update={update} onNext={next} onBack={back} />
            )}
            {step === 2 && (
              <StepReview state={state} onBack={back} onComplete={(id) => setAgentId(id)} agentId={agentId} />
            )}
          </div>
        )}
      </main>
      <RRGFooter />
    </>
  );
}
