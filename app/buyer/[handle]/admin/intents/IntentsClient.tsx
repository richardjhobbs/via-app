'use client';

import { useState } from 'react';

interface Intent {
  id: string;
  intent_text: string;
  structured: Record<string, unknown>;
  status: string;
  broadcast_at: string | null;
  resolved_at: string | null;
  created_at: string;
  matchCount: number;
  discoverable: boolean;
}

/** The structured intent the agent broadcasts by (mirrors BriefIntent server-side). */
interface SearchIntent {
  terms: string[];
  category: string | null;
  type_terms: string[];
  requirements: string[];
  preferences: string[];
  budget_usd: number | null;
  teaser_attribute: string | null;
}

interface Props {
  buyerId: string;
  handle: string;
  initialIntents: Intent[];
}

const OPEN_STATUSES = ['open', 'broadcast', 'matched'];

/** Small editable list of short text chips (add / remove). */
function ChipEditor({ label, hint, items, onChange, disabled }: {
  label: string; hint: string; items: string[];
  onChange: (next: string[]) => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (!items.some((i) => i.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setDraft('');
  }
  return (
    <div>
      <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">{label}</div>
      <div className="text-[11px] text-ink-3 mb-2">{hint}</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {items.length === 0 && <span className="text-xs text-ink-3">none</span>}
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1.5 bg-paper border border-line-strong rounded-full px-2.5 py-1 text-xs">
            {it}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== it))} disabled={disabled}
              className="text-ink-3 hover:text-[color:var(--danger)] disabled:opacity-40" aria-label={`Remove ${it}`}>&times;</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add and press Enter"
          disabled={disabled}
          className="flex-1 bg-paper border border-line-strong rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-ink transition-colors disabled:opacity-50"
        />
        <button type="button" onClick={add} disabled={disabled || draft.trim().length === 0}
          className="px-3 py-1.5 text-xs font-mono tracking-widest uppercase border border-line-strong rounded-md hover:border-ink disabled:opacity-40 transition-colors">Add</button>
      </div>
    </div>
  );
}

export function IntentsClient({ buyerId, handle, initialIntents }: Props) {
  const [intents, setIntents] = useState<Intent[]>(initialIntents);
  const [text, setText]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  // how many offers the buyer wants to see for this brief (caps the dashboard list)
  const [optionCount, setOptionCount] = useState(5);
  // review state: the parsed intent the user can edit before confirming
  const [draftIntent, setDraftIntent] = useState<SearchIntent | null>(null);
  // last-confirmed brief: drives the "view results on your dashboard" note
  const [justConfirmed, setJustConfirmed] = useState<string | null>(null);

  async function review(e: React.FormEvent) {
    e.preventDefault();
    const intentText = text.trim();
    if (intentText.length < 3 || busy) return;
    setErr(''); setJustConfirmed(null); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_text: intentText, preview: true }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      const si = json.search_intent as Partial<SearchIntent>;
      setDraftIntent({
        terms:        Array.isArray(si.terms) ? si.terms : [],
        category:     typeof si.category === 'string' ? si.category : null,
        type_terms:   Array.isArray(si.type_terms) ? si.type_terms : [],
        requirements: Array.isArray(si.requirements) ? si.requirements : [],
        preferences:  Array.isArray(si.preferences) ? si.preferences : [],
        budget_usd:   typeof si.budget_usd === 'number' ? si.budget_usd : null,
        teaser_attribute: typeof si.teaser_attribute === 'string' ? si.teaser_attribute : null,
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !draftIntent) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_text: text.trim(), structured: { search_intent: draftIntent }, option_count: optionCount }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setIntents([{ ...json.intent, matchCount: 0, discoverable: true }, ...intents]);
      setText(''); setDraftIntent(null);
      setJustConfirmed(json.intent?.id ?? 'ok');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally { setBusy(false); }
  }

  async function reinstate(id: string) {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reinstate' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setIntents(intents.map((i) => (i.id === id ? { ...i, status: 'broadcast' } : i)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally { setBusy(false); }
  }

  async function rematch(id: string) {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'rematch' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setIntents(intents.map((i) => (i.id === id ? { ...i, status: 'broadcast' } : i)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally { setBusy(false); }
  }

  async function setDiscoverable(id: string, value: boolean) {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'set_discoverable', value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setIntents(intents.map((i) => (i.id === id ? { ...i, discoverable: value } : i)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally { setBusy(false); }
  }

  async function cancel(id: string) {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) { const json = await res.json().catch(() => ({})); setErr(json.error || `Failed (${res.status})`); return; }
      setIntents(intents.map((i) => (i.id === id ? { ...i, status: 'cancelled' } : i)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally { setBusy(false); }
  }

  const reviewing = draftIntent !== null;

  return (
    <div className="space-y-8">
      {justConfirmed && (
        <div className="bg-paper border rounded-lg p-4 flex items-center justify-between gap-4" style={{ borderColor: 'var(--live)' }}>
          <p className="text-sm text-ink">Your brief is broadcast to the network. Sellers offer against it as they find a match, and offers land on your dashboard.</p>
          <a href={`/buyer/${handle}/admin`} className="shrink-0 text-xs font-mono tracking-widest uppercase hover:underline" style={{ color: 'var(--live)' }}>
            View on dashboard &rarr;
          </a>
        </div>
      )}
      {!reviewing ? (
        <form onSubmit={review} className="bg-paper border border-line rounded-lg p-5">
          <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-2">New brief</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What are you looking for right now? e.g. first pressings on the Stiff label between 1976 and 1979, or raw selvedge denim around 32 waist."
            rows={3}
            disabled={busy}
            className="w-full bg-paper border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink transition-colors disabled:opacity-50"
          />
          {err && <p className="text-xs text-[color:var(--danger)] mt-2">{err}</p>}
          <div className="flex justify-end mt-3">
            <button type="submit" disabled={busy || text.trim().length < 3}
              className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md">
              {busy ? 'Reading…' : 'Review intent'}
            </button>
          </div>
        </form>
      ) : (
        <div className="bg-paper border border-line rounded-lg p-5 space-y-5">
          <div>
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Your agent understood</div>
            <p className="text-sm text-ink-2">Check this is right before broadcasting. Must-haves are enforced; nice-to-haves only rank higher.</p>
          </div>

          <p className="text-sm text-ink border-l-2 border-line-strong pl-3 italic">{text.trim()}</p>

          <div>
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Category</div>
            <input
              value={draftIntent.category ?? ''}
              onChange={(e) => setDraftIntent({ ...draftIntent, category: e.target.value.trim() || null })}
              placeholder="e.g. music/vinyl"
              disabled={busy}
              className="w-full bg-paper border border-line-strong rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-ink transition-colors disabled:opacity-50"
            />
          </div>

          <ChipEditor label="Must have" hint="Hard requirements. A product that fails any of these is excluded."
            items={draftIntent.requirements} disabled={busy}
            onChange={(next) => setDraftIntent({ ...draftIntent, requirements: next })} />

          <ChipEditor label="Nice to have" hint="Preferences. These rank matches higher but never exclude."
            items={draftIntent.preferences} disabled={busy}
            onChange={(next) => setDraftIntent({ ...draftIntent, preferences: next })} />

          <div>
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Budget (USD, optional)</div>
            <input
              type="number" min={0}
              value={draftIntent.budget_usd ?? ''}
              onChange={(e) => setDraftIntent({ ...draftIntent, budget_usd: e.target.value ? Number(e.target.value) : null })}
              placeholder="No cap"
              disabled={busy}
              className="w-40 bg-paper border border-line-strong rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-ink transition-colors disabled:opacity-50"
            />
            <p className="text-[11px] text-ink-3 mt-1">Affordable options rank first; over-budget still shows. Shipping is separate, confirmed with the seller.</p>
          </div>

          <div>
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Options to see</div>
            <input
              type="number" min={1} max={20}
              value={optionCount}
              onChange={(e) => setOptionCount(Math.min(Math.max(Math.trunc(Number(e.target.value) || 1), 1), 20))}
              disabled={busy}
              className="w-40 bg-paper border border-line-strong rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-ink transition-colors disabled:opacity-50"
            />
            <p className="text-[11px] text-ink-3 mt-1">How many of the best offers to show for this brief. Sellers decide which briefs are worth answering.</p>
          </div>

          {err && <p className="text-xs text-[color:var(--danger)]">{err}</p>}

          <div className="flex justify-between items-center">
            <button type="button" onClick={() => setDraftIntent(null)} disabled={busy}
              className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink disabled:opacity-40 transition-colors">
              &larr; Edit text
            </button>
            <button type="button" onClick={() => void confirm()} disabled={busy}
              className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md">
              {busy ? 'Broadcasting…' : 'Confirm & broadcast'}
            </button>
          </div>
        </div>
      )}

      {intents.length === 0 ? (
        <p className="text-sm text-ink-3">No briefs yet. Add one above to point your agent at what you want.</p>
      ) : (
        <ul className="space-y-3">
          {intents.map((intent) => {
            const open = OPEN_STATUSES.includes(intent.status);
            return (
              <li key={intent.id} className="bg-paper border border-line rounded-lg p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded ${open ? 'bg-[color:var(--live)]/10 text-[color:var(--live)]' : 'bg-paper text-ink-3'}`}>
                      {intent.status}
                    </span>
                    <span className="text-[10px] font-mono text-ink-3">
                      {new Date(intent.created_at).toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-sm text-ink leading-relaxed break-words">{intent.intent_text}</p>
                  {open && intent.matchCount === 0 && (
                    <p className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
                      Broadcast to the network. No offers yet for this brief. It stays open and sellers will offer as they find a match.
                    </p>
                  )}
                  {open && (
                    <button
                      type="button"
                      onClick={() => void setDiscoverable(intent.id, !intent.discoverable)}
                      disabled={busy}
                      title="When visible, seller agents can see this brief's structured intent (category, requirements, budget) and pitch matching stock. Your exact wording is never shared."
                      className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-ink-3 hover:text-ink disabled:opacity-40 transition-colors"
                    >
                      <span style={{ width: 6, height: 6, borderRadius: 99, display: 'inline-block', background: intent.discoverable ? 'var(--live)' : 'var(--line-strong)' }} />
                      {intent.discoverable ? 'Visible to sellers' : 'Hidden from sellers'}
                    </button>
                  )}
                </div>
                {open ? (
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <button type="button" onClick={() => void rematch(intent.id)} disabled={busy}
                      className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink disabled:opacity-40 transition-colors" title="Re-broadcast this brief to the network">
                      {busy ? '…' : 'Re-broadcast'}
                    </button>
                    <button type="button" onClick={() => void cancel(intent.id)} disabled={busy}
                      className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-[color:var(--danger)] disabled:opacity-40 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : intent.status === 'cancelled' ? (
                  <button type="button" onClick={() => void reinstate(intent.id)} disabled={busy}
                    className="shrink-0 text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink disabled:opacity-40 transition-colors" title="Reinstate within 24h of cancelling">
                    Reinstate
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
