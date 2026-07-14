'use client';

/**
 * A natural editor for a list of short entries. Each entry is a pill you can
 * remove with a tap; a single input adds new ones on Enter or comma, and
 * pasting a comma or line separated list adds them all at once. Far kinder
 * than a newline-joined textarea, especially straight after a voice answer
 * where you just want to nudge one or two words.
 */
import { useState } from 'react';

export function ChipField({
  label,
  hint,
  values,
  onChange,
  accent = 'var(--ink)',
  placeholder = 'Add one, then Enter',
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  accent?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function addFrom(text: string) {
    const parts = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (!seen.has(p.toLowerCase())) { next.push(p); seen.add(p.toLowerCase()); }
    }
    onChange(next);
    setDraft('');
  }

  function remove(entry: string) {
    onChange(values.filter((v) => v !== entry));
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <label className="br-sans" style={{ display: 'block', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
        {label}
        {hint && <span style={{ textTransform: 'none', letterSpacing: 0 }}> , {hint}</span>}
      </label>
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          background: 'var(--paper)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: '8px 10px',
        }}
      >
        {values.map((entry) => (
          <span
            key={entry}
            className="br-sans"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 999, padding: '4px 6px 4px 11px', fontSize: 14, color: 'var(--ink)' }}
          >
            {entry}
            <button
              type="button"
              onClick={() => remove(entry)}
              aria-label={`Remove ${entry}`}
              style={{ border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          className="br-sans"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFrom(draft); }
            else if (e.key === 'Backspace' && !draft && values.length) { remove(values[values.length - 1]); }
          }}
          onBlur={() => addFrom(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[,\n]/.test(text)) { e.preventDefault(); addFrom(text); }
          }}
          placeholder={values.length ? '' : placeholder}
          style={{ flex: 1, minWidth: 120, border: 'none', outline: 'none', background: 'transparent', color: 'var(--ink)', fontSize: 15, padding: '4px 2px', fontFamily: 'inherit', caretColor: accent }}
        />
      </div>
    </div>
  );
}
