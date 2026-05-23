'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Select, TagSelect } from '@/components/ui/Select';
import { InterestSelector } from './InterestSelector';
import { VOICE_PRESETS, COMM_STYLE_PRESETS, TIER_DISPLAY, STYLE_TAGS } from '@/lib/agent/types';
import type { Agent, InterestSelection } from '@/lib/agent/types';

interface Props {
  agent: Agent;
  onSave: (updates: Partial<Agent>) => Promise<void>;
}

interface PersonaForm {
  persona_bio: string;
  persona_voice: string;
  persona_comm_style: string;
  interest_categories: InterestSelection[];
  style_tags: string[];
  free_instructions: string;
}

export function PersonaCard({ agent, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<PersonaForm>({
    persona_bio: '',
    persona_voice: '',
    persona_comm_style: '',
    interest_categories: [],
    style_tags: [],
    free_instructions: '',
  });

  const tierLabel = TIER_DISPLAY[agent.tier].label;

  function startEdit() {
    setForm({
      persona_bio: agent.persona_bio || '',
      persona_voice: agent.persona_voice || '',
      persona_comm_style: agent.persona_comm_style || '',
      interest_categories: agent.interest_categories || [],
      style_tags: agent.style_tags || [],
      free_instructions: agent.free_instructions || '',
    });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        persona_bio: form.persona_bio || null,
        persona_voice: form.persona_voice || null,
        persona_comm_style: form.persona_comm_style || null,
        interest_categories: form.interest_categories,
        style_tags: form.style_tags,
        free_instructions: form.free_instructions || null,
      } as Partial<Agent>);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const hasPersona =
    agent.persona_bio ||
    agent.persona_voice ||
    agent.persona_comm_style ||
    (agent.interest_categories?.length > 0) ||
    (agent.style_tags?.length > 0) ||
    !!agent.free_instructions;

  // Determine select value for form
  const formVoicePreset = VOICE_PRESETS.some(p => p.value === form.persona_voice) ? form.persona_voice : 'custom';
  const formCommPreset = COMM_STYLE_PRESETS.some(p => p.value === form.persona_comm_style) ? form.persona_comm_style : 'custom';

  // One-line summary for the collapsed state. Mirrors the pattern Activity
  // and "What I know about you" use on the dashboard.
  let summary = `Shape how your ${tierLabel} thinks, communicates, and understands you.`;
  if (hasPersona) {
    const bits: string[] = [];
    if (agent.persona_voice) bits.push(`voice: ${agent.persona_voice.replace(/-/g, ' ')}`);
    if (agent.persona_comm_style) bits.push(`style: ${agent.persona_comm_style.replace(/-/g, ' ')}`);
    const styleCount = agent.style_tags?.length ?? 0;
    if (styleCount > 0) bits.push(`${styleCount} style ${styleCount === 1 ? 'tag' : 'tags'}`);
    const interestCount = agent.interest_categories?.length ?? 0;
    if (interestCount > 0) bits.push(`${interestCount} interest ${interestCount === 1 ? 'group' : 'groups'}`);
    if (agent.persona_bio) bits.push('bio set');
    if (agent.free_instructions) bits.push('instructions set');
    if (bits.length > 0) summary = bits.join(' · ');
  } else {
    summary = `Not configured. Give your ${tierLabel} a personality and voice.`;
  }

  const linkButton: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: 'var(--accent)', padding: 0,
    borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
    whiteSpace: 'nowrap',
  };

  return (
    <Card className="md:col-span-2">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
            Persona
          </h2>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '4px 0 0' }}>
            {summary}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
          {expanded && !editing && (
            <button onClick={startEdit} style={linkButton}>
              {hasPersona ? 'Edit' : 'Set up'}
            </button>
          )}
          {!editing && (
            <button
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              style={linkButton}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      </div>

      {!expanded ? null : editing ? (
        <div className="space-y-4">
          <Textarea
            label="Bio"
            placeholder={`Describe your ${tierLabel}'s personality. Who are they? What drives them?`}
            value={form.persona_bio}
            onChange={(e) => setForm(prev => ({ ...prev, persona_bio: e.target.value }))}
            hint={`This shapes how your ${tierLabel} presents itself and approaches decisions.`}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Select
                label="Voice / tone"
                value={formVoicePreset}
                onChange={(v) => {
                  if (v === 'custom') {
                    setForm(prev => ({ ...prev, persona_voice: '' }));
                  } else {
                    setForm(prev => ({ ...prev, persona_voice: v }));
                  }
                }}
                options={VOICE_PRESETS.map(p => ({
                  value: p.value,
                  label: `${p.label}, ${p.description}`,
                }))}
              />
              {formVoicePreset === 'custom' && (
                <div style={{ marginTop: 8 }}>
                  <Textarea
                    placeholder="Describe the tone you want..."
                    value={form.persona_voice}
                    onChange={(e) => setForm(prev => ({ ...prev, persona_voice: e.target.value }))}
                  />
                </div>
              )}
            </div>

            <div>
              <Select
                label="Communication style"
                value={formCommPreset}
                onChange={(v) => {
                  if (v === 'custom') {
                    setForm(prev => ({ ...prev, persona_comm_style: '' }));
                  } else {
                    setForm(prev => ({ ...prev, persona_comm_style: v }));
                  }
                }}
                options={COMM_STYLE_PRESETS.map(p => ({
                  value: p.value,
                  label: `${p.label}, ${p.description}`,
                }))}
              />
              {formCommPreset === 'custom' && (
                <div style={{ marginTop: 8 }}>
                  <Textarea
                    placeholder="Describe how you want it to communicate..."
                    value={form.persona_comm_style}
                    onChange={(e) => setForm(prev => ({ ...prev, persona_comm_style: e.target.value }))}
                  />
                </div>
              )}
            </div>
          </div>

          <InterestSelector
            selected={form.interest_categories}
            onChange={(ic) => setForm(prev => ({ ...prev, interest_categories: ic }))}
          />

          <TagSelect
            label="Style tags"
            selected={form.style_tags}
            onChange={(tags) => setForm(prev => ({ ...prev, style_tags: tags }))}
            options={[...STYLE_TAGS]}
          />

          <Textarea
            label="Instructions"
            placeholder={`Anything specific you want your ${tierLabel} to keep in mind. Brands you like, what to skip, things you collect.`}
            value={form.free_instructions}
            onChange={(e) => setForm(prev => ({ ...prev, free_instructions: e.target.value }))}
            hint={`Free text. Your ${tierLabel} reasons about these every chat.`}
          />

          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={save} loading={saving}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : hasPersona ? (
        <div className="space-y-3 text-sm">
          {agent.persona_bio && (
            <div>
              <div className="text-white/40 mb-1">Bio</div>
              <div className="text-white/80">{agent.persona_bio}</div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {agent.persona_voice && (
              <div>
                <div className="text-white/40 mb-1">Voice</div>
                <div className="text-white/80 capitalize">{agent.persona_voice.replace(/-/g, ' ')}</div>
              </div>
            )}
            {agent.persona_comm_style && (
              <div>
                <div className="text-white/40 mb-1">Communication</div>
                <div className="text-white/80 capitalize">{agent.persona_comm_style.replace(/-/g, ' ')}</div>
              </div>
            )}
          </div>
          {agent.interest_categories?.length > 0 && (
            <div>
              <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Interests</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {agent.interest_categories.map(ic => (
                  <div key={ic.category} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12, marginRight: 4 }}>{ic.category}:</span>
                    {ic.tags.map(tag => (
                      <span key={tag} style={{
                        padding: '2px 8px',
                        fontFamily: 'var(--font-jetbrains), monospace',
                        fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                        border: '1px solid var(--accent)', color: 'var(--accent)',
                      }}>
                        {tag.replace(/-/g, ' ')}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {agent.style_tags?.length > 0 && (
            <div>
              <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Style tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {agent.style_tags.map(tag => (
                  <span key={tag} style={{
                    padding: '2px 8px',
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                    border: '1px solid var(--accent)', color: 'var(--accent)',
                  }}>
                    {tag.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
          {agent.free_instructions && (
            <div>
              <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Instructions</div>
              <div className="text-white/80" style={{ whiteSpace: 'pre-wrap' }}>{agent.free_instructions}</div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-white/40">
          No persona configured yet. Set one up to give your {tierLabel} a distinct personality and voice.
        </p>
      )}
    </Card>
  );
}
