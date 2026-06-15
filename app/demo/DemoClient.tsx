'use client';

import { useState } from 'react';

interface MatchResult {
  title: string;
  seller: string | null;
  source: string; // 'rrg' | 'via' | ...
  score: number;
  price_usdc: number | null;
  currency: string;
  page_url: string | null;
  mcp_url: string;
  category: string | null;
}

interface BriefIntent {
  terms: string[];
  category: string | null;
  type_terms: string[];
  requirements: string[];
  preferences: string[];
  budget_usd: number | null;
}

interface MatchResponse {
  query: string;
  intent: BriefIntent;
  count: number;
  results: MatchResult[];
}

/** The hero pair: one shared word, two correct worlds. Verified live. */
const HERO = [
  { q: 'raw selvedge denim around 32 waist', label: 'raw selvedge denim, 32 waist' },
  { q: 'raw vinyl records', label: 'raw vinyl records' },
];

/** Further one-click briefs that show semantic judgement, all verified live. */
const MORE = [
  'a gift of coffee for a family member',
  'decaf cold brew',
  'first pressings on the Stiff record label between 1976 and 1979',
  'Japanese selvedge denim',
  'a leather bag',
  'vinyl by Jamiroquai',
];

function sourceLabel(source: string): string {
  if (source === 'via') return 'VIA';
  if (source === 'rrg') return 'RRG';
  return source.toUpperCase();
}

export function DemoClient() {
  const [text, setText]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [ran, setRan]         = useState('');           // the brief that produced the current results
  const [data, setData]       = useState<MatchResponse | null>(null);
  const [copied, setCopied]   = useState(false);

  async function run(brief: string) {
    const q = brief.trim();
    if (q.length < 2 || busy) return;
    setErr(''); setBusy(true); setRan(q); setData(null);
    try {
      const res = await fetch('/api/via/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error === 'rate_limited' ? 'Slow down a moment, the network is rate-limiting this IP.' : (json.error || `Failed (${res.status})`)); return; }
      setData(json as MatchResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally { setBusy(false); }
  }

  const sources = data ? Array.from(new Set(data.results.map((r) => r.source))) : [];

  const curl = `curl -s https://app.getvia.xyz/api/via/match \\
  -H 'content-type: application/json' \\
  -d '{"q":"${ran || 'raw vinyl records'}"}'`;

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked , the snippet is visible to copy by hand */ }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-14 md:py-20">
      {/* Header */}
      <p className="text-xs font-mono tracking-widest text-ink-3 mb-4 uppercase">VIA network , live</p>
      <h1 className="font-serif text-4xl md:text-5xl leading-[1.05] tracking-tight mb-5">
        The marketplace where nobody shops.
      </h1>
      <p className="text-base md:text-lg text-ink-2 leading-relaxed mb-3 max-w-2xl">
        State what you want in plain language. The network&rsquo;s storefront agents answer, and yours
        keeps only what genuinely fits, judged by meaning, not keywords.
      </p>
      <p className="text-sm text-ink-3 leading-relaxed mb-10 max-w-2xl">
        This is the real pipeline an agent calls: it reads your brief, searches every storefront in
        the network at once (VIA + RRG today), and an AI buyer keeps only true matches. Nothing here
        is staged, run any brief yourself.
      </p>

      {/* Hero pair , same word, two worlds */}
      <div className="mb-8">
        <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-3">
          Same word. Two worlds. Try both.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {HERO.map((h) => {
            const active = ran === h.q;
            return (
              <button
                key={h.q}
                type="button"
                onClick={() => void run(h.q)}
                disabled={busy}
                className="text-left bg-paper border rounded-lg p-4 transition-colors disabled:opacity-50 hover:border-ink"
                style={{ borderColor: active ? 'var(--live)' : 'var(--line-strong)' }}
              >
                <div className="text-sm text-ink">&ldquo;{h.label}&rdquo;</div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-ink-3 mt-2">Run this brief &rarr;</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Free brief input */}
      <form
        onSubmit={(e) => { e.preventDefault(); void run(text); }}
        className="bg-paper border border-line rounded-lg p-5 mb-4"
      >
        <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-2">Or write your own brief</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. a gift of coffee, or made in japan raw denim around 34 waist"
            disabled={busy}
            className="flex-1 bg-paper border border-line-strong rounded-md px-3 py-2.5 text-sm outline-none focus:border-ink transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 2}
            className="px-5 py-2.5 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
          >
            {busy ? 'Searching the network…' : 'Search'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {MORE.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void run(m)}
              disabled={busy}
              className="text-[11px] bg-paper border border-line-strong rounded-full px-3 py-1.5 text-ink-2 hover:border-ink disabled:opacity-40 transition-colors"
            >
              {m}
            </button>
          ))}
        </div>
        {err && <p className="text-xs text-[color:var(--danger)] mt-3">{err}</p>}
      </form>

      {/* Working state */}
      {busy && (
        <div className="bg-paper border border-line rounded-lg p-6 text-center">
          <p className="text-sm text-ink-2">Reading your brief and searching every storefront in the network…</p>
          <p className="text-xs font-mono uppercase tracking-widest text-ink-3 mt-2">&ldquo;{ran}&rdquo;</p>
        </div>
      )}

      {/* Results */}
      {!busy && data && (
        <div className="space-y-5">
          {/* Understood , shows it judged, not keyword-matched */}
          <div className="bg-paper border border-line rounded-lg p-5">
            <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Your agent understood</div>
            <div className="flex flex-wrap items-center gap-2">
              {data.intent.category && (
                <span className="text-xs font-mono px-2.5 py-1 rounded-full border" style={{ borderColor: 'var(--line-strong)' }}>
                  {data.intent.category}
                </span>
              )}
              {data.intent.requirements.map((r) => (
                <span key={r} className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'color-mix(in srgb, var(--live) 12%, transparent)', color: 'var(--live)' }}>
                  must: {r}
                </span>
              ))}
              {data.intent.budget_usd != null && (
                <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: 'var(--line-strong)' }}>
                  ≤ ${data.intent.budget_usd}
                </span>
              )}
              {!data.intent.category && data.intent.requirements.length === 0 && data.intent.budget_usd == null && (
                <span className="text-xs text-ink-3">broad brief , judged by category and spirit</span>
              )}
            </div>
          </div>

          {/* Count + federation */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-ink-2">
              {data.count === 0
                ? 'No genuine matches in the network yet , and it does not invent any.'
                : `${data.count} genuine ${data.count === 1 ? 'match' : 'matches'}, judged from across the network`}
            </p>
            {sources.length > 0 && (
              <div className="flex items-center gap-2">
                {sources.map((s) => (
                  <span key={s} className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--line-strong)', color: s === 'via' ? 'var(--live)' : 'var(--ink-2)' }}>
                    {sourceLabel(s)}
                  </span>
                ))}
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">independent storefronts</span>
              </div>
            )}
          </div>

          {/* Result rows */}
          {data.count === 0 ? (
            <div className="bg-paper border border-line rounded-lg p-6">
              <p className="text-sm text-ink-2">
                The network has nothing that truly fits &ldquo;{ran}&rdquo; right now. A keyword search would
                pad this with near-misses; an agent that judges returns nothing rather than waste your time.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {data.results.map((r, i) => (
                <li key={`${r.source}-${i}`} className="bg-paper border border-line rounded-lg p-4 flex items-start gap-4">
                  <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded shrink-0 mt-0.5 border"
                    style={{ borderColor: 'var(--line-strong)', color: r.source === 'via' ? 'var(--live)' : 'var(--ink-2)' }}>
                    {sourceLabel(r.source)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {r.page_url ? (
                      <a href={r.page_url} target="_blank" rel="noopener noreferrer" className="text-sm text-ink hover:underline break-words">
                        {r.title}
                      </a>
                    ) : (
                      <span className="text-sm text-ink break-words">{r.title}</span>
                    )}
                    <div className="text-xs text-ink-3 mt-1">
                      {r.seller ?? sourceLabel(r.source)}
                      {r.category ? ` · ${r.category}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {r.price_usdc != null && (
                      <div className="text-sm text-ink tabular-nums">${r.price_usdc} <span className="text-[10px] text-ink-3">{r.currency}</span></div>
                    )}
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mt-0.5">fit {r.score}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Reproduce it */}
          <div className="bg-paper border border-line rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-mono tracking-widest uppercase text-ink-3">Reproduce this , no account needed</div>
              <button type="button" onClick={() => void copyCurl()} className="text-[10px] font-mono uppercase tracking-widest text-ink-3 hover:text-ink">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="text-[11px] font-mono text-ink-2 overflow-x-auto whitespace-pre leading-relaxed">{curl}</pre>
            <p className="text-[11px] text-ink-3 mt-3 leading-relaxed">
              Or point any MCP client at <code className="text-ink">https://app.getvia.xyz/mcp</code> and call{' '}
              <code className="text-ink">submit_intent</code>. The buyer was never a person at a screen.
            </p>
          </div>
        </div>
      )}

      {/* Idle helper before first run */}
      {!busy && !data && !err && (
        <p className="text-sm text-ink-3 text-center py-8">Pick a brief above, or write your own, to watch the network answer.</p>
      )}
    </div>
  );
}
