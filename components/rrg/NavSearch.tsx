'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

interface BrandItem {
  slug: string;
  name: string;
  headline: string | null;
}

const MAX_RESULTS = 6;

export default function NavSearch({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const router = useRouter();
  const [index, setIndex] = useState<BrandItem[]>([]);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/rrg/brand-index')
      .then((r) => (r.ok ? r.json() : { brands: [] }))
      .then((data: { brands?: BrandItem[] }) => {
        if (!cancelled && Array.isArray(data.brands)) setIndex(data.brands);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index
      .filter((b) => {
        if (b.name.toLowerCase().includes(q)) return true;
        if (b.slug.toLowerCase().includes(q)) return true;
        if (b.headline && b.headline.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, MAX_RESULTS);
  }, [query, index]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const navigateTo = (slug: string) => {
    setQuery('');
    setFocused(false);
    router.push(`/brand/${slug}`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (matches.length === 0) return;
      e.preventDefault();
      const pick = matches[activeIdx] ?? matches[0];
      navigateTo(pick.slug);
    } else if (e.key === 'Escape') {
      setQuery('');
      setFocused(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  const showDropdown = focused && query.trim().length > 0 && matches.length > 0;

  return (
    <div ref={wrapRef} className={`nav-search nav-search-${variant}`}>
      <input
        type="search"
        className="nav-search-input"
        placeholder="Search brands"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={onKey}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search brands"
      />
      {showDropdown && (
        <div className="nav-search-dropdown" role="listbox">
          {matches.map((b, i) => (
            <button
              key={b.slug}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              className={`nav-search-item${i === activeIdx ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                navigateTo(b.slug);
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <div className="nav-search-name">{b.name}</div>
              {b.headline && <div className="nav-search-headline">{b.headline}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
