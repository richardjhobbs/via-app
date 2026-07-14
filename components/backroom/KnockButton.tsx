'use client';

/**
 * Knock on a taste card: ask for an introduction. Human intent only; the
 * server builds the context pack from the two published cards without any
 * LLM. The response is deliberately neutral whether the knock is new or
 * already exists, so nothing about prior state leaks.
 */
import { useState } from 'react';

type KnockState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'delivered' }
  | { kind: 'signin' }
  | { kind: 'needs_card' }
  | { kind: 'error'; message: string };

export function KnockButton({ slug, accent }: { slug: string; accent: string }) {
  const [state, setState] = useState<KnockState>({ kind: 'idle' });

  async function knock() {
    setState({ kind: 'busy' });
    try {
      const res = await fetch(`/api/taste/${encodeURIComponent(slug)}/knock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401) { setState({ kind: 'signin' }); return; }
      const json = await res.json().catch(() => ({})) as { error?: string; needs_card?: boolean };
      if (res.status === 403 && json.needs_card) { setState({ kind: 'needs_card' }); return; }
      if (!res.ok) { setState({ kind: 'error', message: json.error || 'Could not deliver the knock.' }); return; }
      setState({ kind: 'delivered' });
    } catch {
      setState({ kind: 'error', message: 'Could not deliver the knock.' });
    }
  }

  if (state.kind === 'delivered') {
    return (
      <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>
        Knock delivered. If they open the door, you will both hear about it.
      </p>
    );
  }
  if (state.kind === 'signin') {
    return (
      <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>
        <a href={`/backroom?next=/taste/${slug}`} style={{ color: accent }}>Sign in</a> to knock. A knock asks for an introduction; they answer in their own time.
      </p>
    );
  }
  if (state.kind === 'needs_card') {
    return (
      <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>
        Knocking is identity for identity: <a href="/you" style={{ color: accent }}>publish your own card</a> first, so they can see who is asking.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={knock}
        disabled={state.kind === 'busy'}
        className="br-sans"
        style={{
          padding: '12px 26px',
          borderRadius: 999,
          border: '1px solid var(--ink)',
          background: 'var(--ink)',
          color: 'var(--bg)',
          fontSize: 14,
          cursor: state.kind === 'busy' ? 'default' : 'pointer',
          opacity: state.kind === 'busy' ? 0.6 : 1,
        }}
      >
        {state.kind === 'busy' ? 'Knocking...' : 'Knock'}
      </button>
      <p className="br-sans" style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>
        A knock asks for an introduction. They see your card and answer in their own time; no answer means no.
      </p>
      {state.kind === 'error' && (
        <p className="br-sans" style={{ fontSize: 13, color: 'var(--danger)', margin: '8px 0 0' }}>{state.message}</p>
      )}
    </div>
  );
}
