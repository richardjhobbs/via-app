'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Msg {
  role:    'user' | 'assistant';
  content: string;
  at:      number;
}

interface Stats {
  memoriesCount:   number;
  voiceBlockUsed:  boolean;
  tokensUsed:      number;
}

interface Props {
  brandId:       string;
  brandSlug:     string;
  brandName:     string;
  brandHeadline: string | null;
  /**
   * Embed inside another admin page (e.g. the brand-admin tab). Hides the
   * top header and uses a bounded height instead of the full viewport.
   */
  embedded?:     boolean;
}

export default function ConciergePreviewClient({
  brandId,
  brandSlug,
  brandName,
  brandHeadline,
  embedded = false,
}: Props) {
  const rootClass = embedded
    ? 'h-[calc(100vh-14rem)] min-h-[520px] bg-neutral-50 text-neutral-900 flex flex-col border border-neutral-200 rounded-lg overflow-hidden'
    : 'h-screen bg-neutral-50 text-neutral-900 flex flex-col overflow-hidden';

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [stats, setStats]       = useState<Stats | null>(null);
  const scrollRef               = useRef<HTMLDivElement | null>(null);

  // Keep autoscrolling as messages stream in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Msg[] = [...messages, { role: 'user', content: text, at: Date.now() }];
    setMessages(next);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/brand/${brandId}/concierge/preview-chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(err.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setMessages([
        ...next,
        { role: 'assistant', content: data.reply || '(no reply)', at: Date.now() },
      ]);
      setStats({
        memoriesCount:  data.memoriesCount  ?? 0,
        voiceBlockUsed: !!data.voiceBlockUsed,
        tokensUsed:     data.tokensUsed     ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [brandId, input, messages, sending]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  const reset = () => {
    setMessages([]);
    setError(null);
    setStats(null);
  };

  return (
    <div className={rootClass}>
      {!embedded && (
        <header className="bg-white border-b border-neutral-200 px-6 py-4 flex justify-between items-center">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-900">
              {brandName} · Customer Preview
            </span>
            {brandHeadline && (
              <span className="text-xs text-neutral-500 hidden md:inline">{brandHeadline}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {stats && (
              <span className="text-[10px] font-mono text-neutral-500 hidden md:inline">
                {stats.memoriesCount} memories{stats.voiceBlockUsed ? ' · voice on' : ''}
              </span>
            )}
            <a href={`/brand/${brandSlug}`} className="text-xs text-neutral-600 hover:text-neutral-900 font-mono">
              ← {brandName}
            </a>
          </div>
        </header>
      )}

      <div className="flex flex-1 min-h-0">
        <section className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-neutral-500 text-sm border border-dashed border-neutral-300 rounded p-4 leading-relaxed">
                  Ask the {brandName} Concierge anything a shopper might ask: returns,
                  sizing, shipping, fit, store hours, whether they carry a specific brand.
                  The reply is grounded ONLY in the brand's locked-in memories; if a
                  question is not covered, the concierge will say so.
                  <div className="mt-3 text-xs font-mono text-neutral-500">Examples</div>
                  <ul className="mt-1 text-xs font-mono text-neutral-600 space-y-0.5">
                    <li>· Can I order two sizes of a jean and return the one that doesn't fit?</li>
                    <li>· What is your returns window for sale items?</li>
                    <li>· Do you ship Wesco boots to Japan?</li>
                    <li>· What are your store hours in Santa Fe?</li>
                  </ul>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                  <div
                    className={`inline-block max-w-[85%] text-left whitespace-pre-wrap px-4 py-3 rounded-lg shadow-sm ${
                      m.role === 'user'
                        ? 'bg-neutral-900 text-neutral-50'
                        : 'bg-white border border-neutral-200 text-neutral-900'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && <div className="text-neutral-500 font-mono text-xs">thinking...</div>}
              {error && (
                <div className="text-red-700 text-xs font-mono border border-red-200 bg-red-50 rounded p-3">
                  Error: {error}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border-t border-neutral-200 px-6 py-4">
            <div className="max-w-3xl mx-auto">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Ask the ${brandName} Concierge anything. Ctrl/Cmd+Enter to send.`}
                rows={3}
                className="w-full bg-white border border-neutral-300 focus:border-neutral-900 outline-none px-4 py-3 text-sm resize-none font-sans text-neutral-900 placeholder:text-neutral-400 rounded"
                disabled={sending}
              />
              <div className="flex justify-between items-center mt-2">
                <div className="text-xs text-neutral-500 font-mono">
                  preview · grounded in live memories
                  {stats && (
                    <span className="ml-2 text-neutral-400">
                      ({stats.tokensUsed} tokens)
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={reset}
                    disabled={sending || messages.length === 0}
                    className="px-3 py-2 text-xs font-mono text-neutral-600 border border-neutral-300 rounded hover:border-neutral-500 hover:text-neutral-900 disabled:opacity-40"
                  >
                    Reset
                  </button>
                  <button
                    onClick={send}
                    disabled={!input.trim() || sending}
                    className="px-5 py-2 text-sm bg-neutral-900 text-neutral-50 disabled:bg-neutral-300 disabled:text-neutral-500 hover:bg-neutral-700 transition-all rounded"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
