'use client';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 8,
};

export function Select({ label, value, onChange, options, error }: SelectProps) {
  return (
    <div style={{ width: '100%' }}>
      {label && <label style={labelStyle}>{label}</label>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--paper)',
          border: `1px solid ${error ? '#b5453a' : 'var(--line-strong)'}`,
          padding: '12px 14px',
          fontSize: 14,
          fontFamily: 'inherit',
          color: 'var(--ink)',
          outline: 'none',
          appearance: 'none',
          backgroundImage: 'linear-gradient(45deg, transparent 48%, var(--ink-3) 48%, var(--ink-3) 52%, transparent 52%), linear-gradient(-45deg, transparent 48%, var(--ink-3) 48%, var(--ink-3) 52%, transparent 52%)',
          backgroundPosition: 'right 14px center, right 20px center',
          backgroundSize: '6px 6px',
          backgroundRepeat: 'no-repeat',
          paddingRight: 40,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p style={{ marginTop: 6, fontSize: 11, color: '#b5453a', fontFamily: 'var(--font-jetbrains), monospace' }}>{error}</p>}
    </div>
  );
}

// ── Tag multi-select ─────────────────────────────────────────────────

interface TagSelectProps {
  label?: string;
  selected: string[];
  onChange: (tags: string[]) => void;
  options: string[];
}

export function TagSelect({ label, selected, onChange, options }: TagSelectProps) {
  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  return (
    <div style={{ width: '100%' }}>
      {label && <label style={labelStyle}>{label}</label>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`chip ${selected.includes(tag) ? 'is-active' : ''}`}
            style={{ padding: '6px 12px' }}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
