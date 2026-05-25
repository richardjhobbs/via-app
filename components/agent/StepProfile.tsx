'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select, TagSelect } from '@/components/ui/Select';
import { InterestSelector } from './InterestSelector';
import { BrandPicker } from './BrandPicker';
import { SizeInput } from './SizeInput';
import { STYLE_TAGS, VOICE_PRESETS, COMM_STYLE_PRESETS, TIER_DISPLAY } from '@/lib/agent/types';
import type { WizardState } from '@/lib/agent/types';

interface Props {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepProfile({ state, update, onNext, onBack }: Props) {
  const [showPersona, setShowPersona] = useState(false);
  const tierLabel = TIER_DISPLAY[state.tier].label;

  const voicePreset = VOICE_PRESETS.some(p => p.value === state.persona_voice) ? state.persona_voice : 'custom';
  const commPreset = COMM_STYLE_PRESETS.some(p => p.value === state.persona_comm_style) ? state.persona_comm_style : 'custom';

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

  return (
    <div>
      <h2 style={headingStyle}>Configure your {tierLabel}.</h2>
      <p style={subheadStyle}>
        Tell your {tierLabel} what to look for. {state.tier === 'basic'
          ? 'Instructions are parsed into rules, be specific.'
          : `Your ${tierLabel} will interpret these with judgement and adapt over time.`}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>
        <BrandPicker
          label="Brands you love"
          hint="Pick brands already on the VIA network. Your concierge will prioritise their drops and learn from your taste."
          selected={state.loved_brands}
          onChange={(slugs) => update({ loved_brands: slugs })}
          disabledSlugs={state.avoided_brands}
        />

        <BrandPicker
          label="Brands you skip"
          hint="Your concierge will not recommend these."
          selected={state.avoided_brands}
          onChange={(slugs) => update({ avoided_brands: slugs })}
          disabledSlugs={state.loved_brands}
        />

        <SizeInput
          value={state.sizes}
          onChange={(sizes) => update({ sizes })}
        />

        <TagSelect
          label="Style tags"
          selected={state.style_tags}
          onChange={(tags) => update({ style_tags: tags })}
          options={[...STYLE_TAGS]}
        />

        <Textarea
          label="Instructions"
          placeholder={
            state.tier === 'basic'
              ? 'e.g. "Only streetwear. Never bid over $200. Skip luxury brands. Prefer deadstock."'
              : 'e.g. "I collect deadstock Nike from the 90s-2000s. Willing to pay premium for unworn condition. Skip anything mass-produced unless it\'s genuinely rare."'
          }
          value={state.free_instructions}
          onChange={(e) => update({ free_instructions: e.target.value })}
          hint={
            state.tier === 'basic'
              ? 'These are parsed into rules: price limits, brand/tag whitelists, keyword filters.'
              : `Your ${tierLabel} will use these to reason about each drop.`
          }
        />

        <Input
          label="Budget ceiling (USDC per transaction)"
          type="number"
          placeholder="e.g. 500"
          value={state.budget_ceiling_usdc}
          onChange={(e) => update({ budget_ceiling_usdc: e.target.value })}
        />

        <Select
          label="Bid style"
          value={state.bid_aggression}
          onChange={(v) =>
            update({
              bid_aggression: v as 'conservative' | 'balanced' | 'aggressive',
            })
          }
          options={[
            { value: 'conservative', label: 'Conservative, bid at or near reserve' },
            { value: 'balanced',     label: 'Balanced, bid midpoint between reserve and ceiling' },
            { value: 'aggressive',   label: 'Aggressive, bid at ceiling immediately' },
          ]}
        />

        {/* LLM provider selector removed 2026-05-25: only DeepSeek is wired
            for tool use. Wizard defaults llm_provider to 'deepseek' (see
            CreateAgentWizard.tsx), so nothing to choose. Restore the Select
            here once a second provider is supported. */}
      </div>

      {/* Persona section (optional, collapsible) */}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20, marginBottom: 32 }}>
        <button
          type="button"
          onClick={() => setShowPersona(!showPersona)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--ink-2)',
            marginBottom: 16, padding: 0,
          }}
        >
          <span style={{ fontSize: 9, color: 'var(--accent)' }}>{showPersona ? '▼' : '▶'}</span>
          <span>Persona (optional)</span>
          <span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
            give your {tierLabel} a personality
          </span>
        </button>

        {showPersona && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Textarea
              label="Bio"
              placeholder={`Describe who your ${tierLabel} is. What drives them? What's their perspective?`}
              value={state.persona_bio}
              onChange={(e) => update({ persona_bio: e.target.value })}
              hint={`This shapes how your ${tierLabel} approaches decisions and communicates.`}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div>
                <Select
                  label="Voice / tone"
                  value={voicePreset}
                  onChange={(v) => {
                    update({ persona_voice: v === 'custom' ? '' : v });
                  }}
                  options={VOICE_PRESETS.map(p => ({
                    value: p.value,
                    label: `${p.label}, ${p.description}`,
                  }))}
                />
                {voicePreset === 'custom' && (
                  <div style={{ marginTop: 8 }}>
                    <Textarea
                      placeholder="Describe the tone you want..."
                      value={state.persona_voice}
                      onChange={(e) => update({ persona_voice: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div>
                <Select
                  label="Communication style"
                  value={commPreset}
                  onChange={(v) => {
                    update({ persona_comm_style: v === 'custom' ? '' : v });
                  }}
                  options={COMM_STYLE_PRESETS.map(p => ({
                    value: p.value,
                    label: `${p.label}, ${p.description}`,
                  }))}
                />
                {commPreset === 'custom' && (
                  <div style={{ marginTop: 8 }}>
                    <Textarea
                      placeholder="Describe how you want it to communicate..."
                      value={state.persona_comm_style}
                      onChange={(e) => update({ persona_comm_style: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>

            <InterestSelector
              selected={state.interest_categories}
              onChange={(ic) => update({ interest_categories: ic })}
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext}>Review</Button>
      </div>
    </div>
  );
}
