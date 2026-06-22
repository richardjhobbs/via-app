'use client';

import { useState } from 'react';

/**
 * Discoverability switch for a Buying Agent. When on, the agent's briefs are
 * broadcast to seller agents (demand feed + offer door); when off, briefs stay
 * private and receive no offers. This is the control that decides whether a
 * brief can get a response at all.
 */
export function BuyerVisibilityToggle({ buyerId, initialPublic }: { buyerId: string; initialPublic: boolean }) {
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !isPublic;
    setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: next }),
      });
      if (res.ok) setIsPublic(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="dash-mcp uc-mono"
      title={isPublic
        ? 'Your briefs are broadcast to seller agents. Click to make this agent private.'
        : 'Your briefs are NOT broadcast, sellers cannot see or offer on them. Click to make this agent discoverable.'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: isPublic ? 'var(--live)' : 'var(--ink-3)',
        borderColor: isPublic ? 'var(--live)' : 'var(--line-strong)',
      }}
    >
      <span aria-hidden style={{
        width: 7, height: 7, borderRadius: '50%',
        background: isPublic ? 'var(--live)' : 'var(--ink-3)', display: 'inline-block',
      }} />
      {busy ? 'Saving…' : isPublic ? 'Discoverable' : 'Private'}
    </button>
  );
}
