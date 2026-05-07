'use client';

import { useEffect, useMemo, useState } from 'react';

interface Brand {
  slug: string;
  name: string;
  drop_count: number;
}

interface Props {
  label: string;
  hint?: string;
  selected: string[];                      // brand slugs
  onChange: (slugs: string[]) => void;
  disabledSlugs?: string[];                // e.g. brands picked in the OTHER list
}

interface DropRow {
  brand_slug?: string | null;
  brand_name?: string | null;
  hidden?: boolean;
  status?: string;
}

export function BrandPicker({ label, hint, selected, onChange, disabledSlugs }: Props) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/rrg/drops');
        if (!res.ok) throw new Error(`drops API ${res.status}`);
        const data = await res.json();
        const drops: DropRow[] = (data.drops ?? []) as DropRow[];
        const counts = new Map<string, Brand>();
        for (const d of drops) {
          if (d.hidden || d.status !== 'approved') continue;
          if (!d.brand_slug || !d.brand_name) continue;
          const existing = counts.get(d.brand_slug);
          if (existing) existing.drop_count++;
          else counts.set(d.brand_slug, { slug: d.brand_slug, name: d.brand_name, drop_count: 1 });
        }
        const sorted = Array.from(counts.values()).sort((a, b) => b.drop_count - a.drop_count);
        setBrands(sorted);
      } catch (err) {
        console.error('[BrandPicker] failed to load brands:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const disabledSet = useMemo(() => new Set(disabledSlugs ?? []), [disabledSlugs]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    if (!filter.trim()) return brands;
    const q = filter.toLowerCase();
    return brands.filter(b => b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q));
  }, [brands, filter]);

  function toggle(slug: string) {
    if (disabledSet.has(slug)) return;
    if (selectedSet.has(slug)) onChange(selected.filter(s => s !== slug));
    else onChange([...selected, slug]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{
        display: 'block',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--ink-3)',
      }}>
        {label}
      </label>
      {hint && (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0, lineHeight: 1.5 }}>{hint}</p>
      )}

      <input
        type="text"
        placeholder={loading ? 'Loading brands…' : `Filter ${brands.length} brands…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        disabled={loading}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line-strong)',
          padding: '8px 12px',
          fontSize: 13,
          fontFamily: 'inherit',
          color: 'var(--ink)',
          outline: 'none',
        }}
      />

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        maxHeight: 200, overflowY: 'auto',
        padding: 8, border: '1px solid var(--line)',
        background: 'var(--bg-2)',
      }}>
        {loading && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Loading…</span>}
        {!loading && visible.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>No brands match.</span>
        )}
        {visible.map(b => {
          const isSelected = selectedSet.has(b.slug);
          const isDisabled = disabledSet.has(b.slug);
          return (
            <button
              key={b.slug}
              type="button"
              onClick={() => toggle(b.slug)}
              disabled={isDisabled}
              className={`chip ${isSelected ? 'is-active' : ''}`}
              title={isDisabled ? 'Already selected in the other list' : `${b.drop_count} drops`}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                opacity: isDisabled ? 0.35 : 1,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {b.name}
              <span style={{ marginLeft: 6, color: 'var(--ink-3)', fontSize: 9 }}>
                {b.drop_count}
              </span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <span style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--accent)',
        }}>
          {selected.length} selected
        </span>
      )}
    </div>
  );
}
