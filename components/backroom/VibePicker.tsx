'use client';

/**
 * The Appearance picker: a member chooses one of four vibes (palettes) and it
 * follows them across every Back Room surface. The choice persists server-side
 * (app_room_member_prefs.vibe); for instant feedback we also flip the live
 * data-vibe attribute on the route-group wrapper, so the whole page recolours
 * without a reload. On a failed save we revert both.
 */
import { useState, useCallback } from 'react';

type Vibe = 'paper' | 'slate' | 'midnight' | 'bloom';

const VIBE_LIST: { key: Vibe; name: string; ground: string; ink: string }[] = [
  { key: 'paper', name: 'Paper', ground: '#f4efe6', ink: '#211b15' },
  { key: 'slate', name: 'Slate', ground: '#e7e9ee', ink: '#1c2230' },
  { key: 'midnight', name: 'Midnight', ground: '#17130d', ink: '#e8dcc4' },
  { key: 'bloom', name: 'Bloom', ground: '#f6ecec', ink: '#3a2230' },
];

function applyVibe(v: Vibe) {
  if (typeof document !== 'undefined') {
    document.querySelector('[data-skin="backroom"]')?.setAttribute('data-vibe', v);
  }
}

export function VibePicker({ handle, current }: { handle: string | null; current: Vibe }) {
  const [vibe, setVibe] = useState<Vibe>(current);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async (next: Vibe) => {
    if (!handle || busy || next === vibe) return;
    const prev = vibe;
    setVibe(next);
    applyVibe(next);
    setBusy(true);
    try {
      const res = await fetch('/api/backroom/prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: handle, vibe: next }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      setVibe(prev);
      applyVibe(prev);
    } finally {
      setBusy(false);
    }
  }, [handle, vibe, busy]);

  return (
    <div style={cardStyle}>
      <p className="br-serif" style={{ fontSize: 18, margin: 0 }}>Appearance</p>
      <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: '6px 0 0', lineHeight: 1.5 }}>
        Choose a vibe. It stays with you across all your rooms.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 12 }}>
        {VIBE_LIST.map((v) => {
          const selected = v.key === vibe;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => pick(v.key)}
              disabled={busy}
              className="br-sans"
              aria-pressed={selected}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                padding: '10px 12px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                border: selected ? '1.5px solid var(--ink)' : '1px solid var(--line-strong)',
                background: 'var(--bg)', color: 'var(--ink)', fontSize: 14,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: v.ground, border: '1px solid var(--line-strong)',
                  boxShadow: `inset 0 0 0 6px ${v.ink}`,
                }}
              />
              <span style={{ flex: 1 }}>{v.name}</span>
              {selected && <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 13 }}>&#10003;</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'block', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 18px',
  background: 'var(--paper)', textDecoration: 'none',
};
