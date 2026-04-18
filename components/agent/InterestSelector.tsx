'use client';

import { useState } from 'react';
import { INTEREST_CATEGORIES } from '@/lib/agent/types';
import type { InterestSelection, InterestCategoryKey } from '@/lib/agent/types';

interface Props {
  selected: InterestSelection[];
  onChange: (selections: InterestSelection[]) => void;
}

export function InterestSelector({ selected, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectedMap = new Map(selected.map(s => [s.category, new Set(s.tags)]));

  function toggleTag(category: string, tag: string) {
    const current = selectedMap.get(category) ?? new Set<string>();
    if (current.has(tag)) current.delete(tag);
    else current.add(tag);

    const next: InterestSelection[] = [];
    for (const [cat, tags] of selectedMap) {
      if (cat === category) {
        if (current.size > 0) next.push({ category, tags: [...current] });
      } else {
        next.push({ category: cat, tags: [...tags] });
      }
    }
    if (!selectedMap.has(category) && current.size > 0) {
      next.push({ category, tags: [...current] });
    }
    onChange(next);
  }

  function isSelected(category: string, tag: string): boolean {
    return selectedMap.get(category)?.has(tag) ?? false;
  }

  function categoryCount(category: string): number {
    return selectedMap.get(category)?.size ?? 0;
  }

  const categories = Object.entries(INTEREST_CATEGORIES) as [InterestCategoryKey, typeof INTEREST_CATEGORIES[InterestCategoryKey]][];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{
        display: 'block',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--ink-3)',
      }}>
        Interests
      </label>
      {categories.map(([key, cat]) => {
        const count = categoryCount(key);
        const isOpen = expanded === key;
        return (
          <div key={key} style={{ border: '1px solid var(--line)', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : key)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px',
                fontSize: 14, fontFamily: 'inherit',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--ink)',
              }}
            >
              <span>{cat.label}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {count > 0 && (
                  <span style={{
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: 'var(--accent)',
                  }}>
                    {count} selected
                  </span>
                )}
                <span style={{ color: 'var(--ink-3)', fontSize: 10 }}>{isOpen ? '▲' : '▼'}</span>
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cat.tags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(key, tag)}
                    className={`chip ${isSelected(key, tag) ? 'is-active' : ''}`}
                    style={{ padding: '4px 10px', fontSize: 10 }}
                  >
                    {tag.replace(/-/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
