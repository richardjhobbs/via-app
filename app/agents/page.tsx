'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';
import { Stepper } from '@/components/ui/Stepper';
import { StepRegistration } from '@/components/agent/StepRegistration';
import { StepProfile } from '@/components/agent/StepProfile';
import { StepReview } from '@/components/agent/StepReview';
import type { AgentTier, WizardState } from '@/lib/agent/types';

const initialState: WizardState = {
  tier: 'basic',
  email: '',
  name: '',
  wallet_address: '',
  wallet_type: 'embedded',
  style_tags: [],
  free_instructions: '',
  budget_ceiling_usdc: '',
  bid_aggression: 'balanced',
  llm_provider: 'claude',
  persona_bio: '',
  persona_voice: '',
  persona_comm_style: '',
  interest_categories: [],
};

const WIZARD_STEPS = ['Service', 'Registration', 'Profile', 'Review'];

export default function AgentsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const [wizardActive, setWizardActive] = useState(false);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(initialState);
  const [agentId, setAgentId] = useState<string | null>(null);

  const update = (partial: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...partial }));
  const next = () => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  const back = () => {
    if (step === 1) setWizardActive(false);
    else setStep((s) => Math.max(s - 1, 1));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agent/session');
        if (res.ok) {
          router.push('/agents/dashboard');
          return;
        }
      } catch {}
      setChecking(false);
    })();
  }, [router]);

  function selectTier(tier: AgentTier) {
    setState(prev => ({ ...prev, tier }));
    setStep(1);
    setWizardActive(true);
  }

  if (checking) {
    return (
      <>
        <RRGHeader active="concierge" />
        <main className="page-pad">
          <p style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Loading…</p>
        </main>
        <RRGFooter />
      </>
    );
  }

  return (
    <>
      <RRGHeader active="concierge" />
      <main className="page-pad" style={{ maxWidth: 1200 }}>
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
                Your <em>Personal Shopper.</em><br/>Your <em>Concierge.</em>
              </h1>
              <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.65, maxWidth: '62ch', fontWeight: 300 }}>
                Start with a Personal Shopper that handles the basics, finding,
                filtering, and surfacing what matches your taste on Real Real Genuine.
                Upgrade to a Concierge that learns your style, negotiates on your
                behalf, and acts with judgement. You set the rules. They do the work.
              </p>
            </div>

            {/* ── Two-tier choice ──────────────────────────── */}
            <div className="collab-inner" style={{ padding: 0, marginBottom: 40 }}>
              {/* Personal Shopper */}
              <button
                type="button"
                onClick={() => selectTier('basic')}
                className="collab-card"
                style={{ textAlign: 'left', background: 'var(--paper)', cursor: 'pointer', minHeight: 420 }}
              >
                <div className="tag-line">
                  <span className="uc-mono" style={{ color: 'var(--accent)' }}>Tier one</span>
                  <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>Free</span>
                </div>
                <div>
                  <h4><em>Personal Shopper.</em></h4>
                  <p>
                    Works on the preferences you set. Finds, filters, and surfaces what matches.
                    Like having someone on retainer at your favourite store.
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.8 }}>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Works on your set preferences and criteria
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Automatic bidding when rules match
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Wallet and a VIA Agent identity (ERC-8004 verified)
                    </li>
                    <li style={{ paddingLeft: 14, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                      Dashboard and email notifications
                    </li>
                  </ul>
                </div>
                <div className="c-cta">
                  <span className="btn" style={{ padding: '12px 20px', fontSize: 12 }}>
                    Get started free <span className="arrow">→</span>
                  </span>
                </div>
              </button>

              {/* Concierge */}
              <button
                type="button"
                onClick={() => selectTier('pro')}
                className="collab-card"
                style={{ textAlign: 'left', background: 'var(--paper)', cursor: 'pointer', minHeight: 420, borderColor: 'var(--accent)' }}
              >
                <div className="tag-line">
                  <span className="uc-mono" style={{ color: 'var(--accent)' }}>Tier two</span>
                  <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>Credit-based</span>
                </div>
                <div>
                  <h4><em>Concierge.</em></h4>
                  <p>
                    Learns your taste, understands nuance, and negotiates on your behalf.
                    Powered by Claude or DeepSeek. The relationship deepens over time.
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
                      Falls back to Personal Shopper when credits run out
                    </li>
                  </ul>
                </div>
                <div className="c-cta">
                  <span className="btn accent" style={{ padding: '12px 20px', fontSize: 12 }}>
                    Get started with Concierge <span className="arrow">→</span>
                  </span>
                </div>
              </button>
            </div>

            {/* Already signed up */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}>
              <button
                onClick={() => router.push('/agents/dashboard')}
                className="btn ghost"
                style={{ fontSize: 11, padding: '12px 24px', letterSpacing: '0.14em', textTransform: 'uppercase' }}
              >
                Already signed up? Go to your dashboard <span className="arrow">→</span>
              </button>
            </div>
          </>
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <Stepper steps={WIZARD_STEPS} currentStep={step} />
            {step === 1 && (
              <StepRegistration state={state} update={update} onNext={next} onBack={back} />
            )}
            {step === 2 && (
              <StepProfile state={state} update={update} onNext={next} onBack={back} />
            )}
            {step === 3 && (
              <StepReview state={state} onBack={back} onComplete={(id) => setAgentId(id)} agentId={agentId} />
            )}
          </div>
        )}
      </main>
      <RRGFooter />
    </>
  );
}
