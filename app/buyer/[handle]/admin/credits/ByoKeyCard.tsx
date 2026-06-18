'use client';

import { useState } from 'react';

export interface ByoStatus {
  connected: boolean;
  provider: string | null;
  last4: string | null;
  model: string | null;
}

const PROVIDERS = [
  { value: 'openai',     label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter (Claude, Gemini, Llama, etc.)' },
];

export function ByoKeyCard({ buyerId, initial }: { buyerId: string; initial: ByoStatus }) {
  const [status, setStatus] = useState<ByoStatus>(initial);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey]     = useState('');
  const [model, setModel]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy || apiKey.trim().length < 16) { setErr('Enter a valid API key.'); return; }
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/byo-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), model: model.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setStatus({ connected: true, provider: json.provider, last4: json.last4, model: json.model });
      setApiKey(''); setModel('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/buyer/${buyerId}/byo-key`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); return; }
      setStatus({ connected: false, provider: null, last4: null, model: null });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-paper border border-line rounded-lg p-6 space-y-4">
      <div>
        <h2 className="text-sm font-medium mb-1">Use your own LLM key</h2>
        <p className="text-sm text-ink-2">
          Connect your own OpenAI or OpenRouter key and your agent runs on it directly , platform
          credits are not consumed while a key is connected. OpenRouter reaches Claude, Gemini and
          more through one key.
        </p>
      </div>

      {status.connected ? (
        <div className="flex items-center justify-between gap-4 bg-background border border-line-strong rounded-md px-4 py-3">
          <div className="text-sm">
            <span className="font-mono uppercase text-xs tracking-widest text-[color:var(--live)]">Connected</span>
            <span className="text-ink-2"> · {status.provider} · ····{status.last4}{status.model ? ` · ${status.model}` : ''}</span>
          </div>
          <button type="button" onClick={disconnect} disabled={busy}
            className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-[color:var(--danger)] disabled:opacity-40">
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={connect} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={busy}
                className="w-full bg-background border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink">
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            {provider === 'openrouter' && (
              <div>
                <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Model (optional)</label>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}
                  placeholder="anthropic/claude-sonnet-4"
                  className="w-full bg-background border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">API key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={busy}
              spellCheck={false} autoComplete="off" placeholder="sk-…"
              className="w-full bg-background border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink" />
          </div>
          {err && <p className="text-xs text-[color:var(--danger)]">{err}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy || apiKey.trim().length < 16}
              className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md">
              {busy ? 'Validating…' : 'Connect key'}
            </button>
          </div>
        </form>
      )}
      {status.connected && err && <p className="text-xs text-[color:var(--danger)]">{err}</p>}
    </div>
  );
}
