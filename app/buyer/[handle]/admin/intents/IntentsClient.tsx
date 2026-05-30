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
}

interface Props {
  buyerId: string;
  initialIntents: Intent[];
}

const OPEN_STATUSES = ['open', 'broadcast', 'matched'];

export function IntentsClient({ buyerId, initialIntents }: Props) {
  const [intents, setIntents] = useState<Intent[]>(initialIntents);
  const [text, setText]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const intentText = text.trim();
    if (intentText.length < 3 || busy) return;
    setErr('');
    setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_text: intentText }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Failed (${res.status})`);
        return;
      }
      setIntents([json.intent, ...intents]);
      setText('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (busy) return;
    setErr('');
    setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/intents?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErr(json.error || `Failed (${res.status})`);
        return;
      }
      setIntents(intents.map((i) => (i.id === id ? { ...i, status: 'cancelled' } : i)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={create} className="bg-paper border border-line rounded-lg p-5">
        <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-2">
          New intent
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What are you looking for right now? e.g. a refurbished espresso machine under $400, collection in London."
          rows={3}
          disabled={busy}
          className="w-full bg-paper border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink transition-colors disabled:opacity-50"
        />
        {err && <p className="text-xs text-[color:var(--danger)] mt-2">{err}</p>}
        <div className="flex justify-end mt-3">
          <button
            type="submit"
            disabled={busy || text.trim().length < 3}
            className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
          >
            Add intent
          </button>
        </div>
      </form>

      {intents.length === 0 ? (
        <p className="text-sm text-ink-3">No intents yet. Add one above to point your agent at what you want.</p>
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
                </div>
                {open && (
                  <button
                    type="button"
                    onClick={() => void cancel(intent.id)}
                    disabled={busy}
                    className="shrink-0 text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-[color:var(--danger)] disabled:opacity-40 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
