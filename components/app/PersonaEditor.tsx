'use client';

import { useState } from 'react';

/**
 * Brand persona editor on the seller dashboard. The persona (app_sellers
 * .description, plus the shorter headline tagline) is the text the seller's Sales
 * Agent reasons with to decide which buyer briefs to answer and what to offer,
 * exposed to agents as the standard `brand_persona` field on the seller MCP.
 * A thin persona makes the agent miss matches, so this surface explains why and
 * shows a worked example.
 */
export default function PersonaEditor({
  sellerId, initialHeadline, initialDescription,
}: {
  sellerId: string;
  initialHeadline: string;
  initialDescription: string;
}) {
  const [headline, setHeadline]       = useState(initialHeadline);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving]           = useState(false);
  const [msg, setMsg]                 = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/seller/${sellerId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: headline.trim(), description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: data.error || 'Could not save.' }); return; }
      setMsg({ ok: true, text: 'Saved. Your agent will use this on its next brief.' });
    } catch {
      setMsg({ ok: false, text: 'Could not save. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Brand persona</h3>
        <div className="uc-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>your agent&rsquo;s brief</div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', padding: '4px 2px 12px' }}>
        This is what your Sales Agent reads to judge buyer requests as your brand and pick what to
        offer. Name your identity, what you make, who it is for, and your vibe. A vague line
        (&ldquo;home baked bread and more&rdquo;) makes it miss matches.
      </p>

      <label className="block" style={{ marginBottom: 12 }}>
        <span className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>Tagline (short)</span>
        <input
          type="text" value={headline} maxLength={200}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="One line that sums up the brand."
          style={{ width: '100%', background: 'var(--paper)', border: '1px solid var(--line-strong)', padding: '10px 12px', fontSize: 14, color: 'var(--ink)' }}
        />
      </label>

      <label className="block">
        <span className="uc-mono" style={{ fontSize: 10, color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>Persona</span>
        <textarea
          value={description} rows={5} maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Who you are, what you make, who it is for, and your vibe. Example: A British lifestyle brand built around the annual 3,000-mile international motor rally. Apparel, headwear, and accessories for fans of cars, motorsport, and the racing lifestyle."
          style={{ width: '100%', background: 'var(--paper)', border: '1px solid var(--line-strong)', padding: '10px 12px', fontSize: 14, color: 'var(--ink)', resize: 'vertical' }}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <button type="button" className="btn" onClick={save} disabled={saving || !description.trim()}>
          {saving ? 'Saving…' : 'Save persona'}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.ok ? 'var(--live)' : 'var(--danger)' }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
