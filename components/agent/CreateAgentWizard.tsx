'use client';

import { useState } from 'react';
import { Stepper } from '@/components/ui/Stepper';
import { StepTier } from './StepTier';
import { StepRegistration } from './StepRegistration';
import { StepProfile } from './StepProfile';
import { StepReview } from './StepReview';
import type { WizardState } from '@/lib/agent/types';
import { EMPTY_SIZE_PROFILE } from '@/lib/agent/types';

// Re-export for backward compat
export type { WizardState };

const STEPS = ['Tier', 'Registration', 'Profile', 'Review'];

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
  loved_brands: [],
  avoided_brands: [],
  sizes: { ...EMPTY_SIZE_PROFILE },
};

export function CreateAgentWizard() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [agentId, setAgentId] = useState<string | null>(null);

  const update = (partial: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...partial }));

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="max-w-2xl mx-auto">
      <Stepper steps={STEPS} currentStep={step} />

      {step === 0 && (
        <StepTier state={state} update={update} onNext={next} />
      )}
      {step === 1 && (
        <StepRegistration
          state={state}
          update={update}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 2 && (
        <StepProfile
          state={state}
          update={update}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 3 && (
        <StepReview
          state={state}
          onBack={back}
          onComplete={(id) => setAgentId(id)}
          agentId={agentId}
        />
      )}
    </div>
  );
}
