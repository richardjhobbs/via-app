'use client';

import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import type { SizeProfile } from '@/lib/agent/types';

interface Props {
  value: SizeProfile;
  onChange: (next: SizeProfile) => void;
}

export function SizeInput({ value, onChange }: Props) {
  function set<K extends keyof SizeProfile>(key: K, v: SizeProfile[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{
        display: 'block',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--ink-3)',
      }}>
        Sizes (optional)
      </label>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0, lineHeight: 1.5 }}>
        Helps your concierge filter recommendations. Use whatever sizing you usually shop in (UK, EU, US, alpha).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Select
          label="Section"
          value={value.sex ?? ''}
          onChange={(v) => set('sex', v as SizeProfile['sex'])}
          options={[
            { value: '', label: 'Not specified' },
            { value: 'menswear', label: 'Menswear' },
            { value: 'womenswear', label: 'Womenswear' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <Input
          label="Tops"
          placeholder="e.g. M, UK 10, EU 38"
          value={value.tops ?? ''}
          onChange={(e) => set('tops', e.target.value)}
        />
        <Input
          label="Bottoms"
          placeholder="e.g. 32W 32L, UK 10"
          value={value.bottoms ?? ''}
          onChange={(e) => set('bottoms', e.target.value)}
        />
        <Input
          label="Shoes"
          placeholder="e.g. UK 9, EU 43, US 10"
          value={value.shoes ?? ''}
          onChange={(e) => set('shoes', e.target.value)}
        />
      </div>

      <Textarea
        label="Sizing notes"
        placeholder="Anything brand-specific, e.g. 'I size up in Frey Tailored', 'Engineered Garments runs short'."
        value={value.notes ?? ''}
        onChange={(e) => set('notes', e.target.value)}
      />
    </div>
  );
}
