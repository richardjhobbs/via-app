'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Memory {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
}

interface ToolCall {
  name: string;
  input: unknown;
  result: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  at: number;
}

interface Props {
  brandId: string;
  brandSlug: string;
  brandName: string;
  brandHeadline: string | null;
  /**
   * When true, renders with a bounded height suitable for embedding inside
   * another admin page tab (no full-viewport takeover, no top-level header).
   * Used by the Brand Admin Concierge tab at /brand/[slug]/admin.
   */
  embedded?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  event: 'Event',
  stock_note: 'Stock',
  promotion: 'Promo',
  brand_update: 'Update',
  policy: 'Policy',
  general: 'General',
};

export default function ConciergeChatClient({ brandId, brandSlug, brandName, brandHeadline, embedded = false }: Props) {
  // h-screen (not min-h-screen) bounds the whole panel to the viewport so the
  // inner messages list and the memories aside scroll independently, keeping
  // the composer pinned at the bottom even when there are many memories.
  const rootClass = embedded
    ? 'h-[calc(100vh-14rem)] min-h-[520px] bg-neutral-50 text-neutral-900 flex flex-col border border-neutral-200 rounded-lg overflow-hidden'
    : 'h-screen bg-neutral-50 text-neutral-900 flex flex-col overflow-hidden';
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [deniedReason, setDeniedReason] = useState<string>('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memFilter, setMemFilter] = useState<'all' | string>('all');
  // Memory view: 'compact' shows type + title + expiry only (so the composer
  // stays in reach when there are many long memories); 'expanded' shows full
  // body and tags. Persisted per-brand so the choice survives a reload.
  const memViewStorageKey = `rrg.concierge.memView.${brandSlug}`;
  const [memView, setMemView] = useState<'compact' | 'expanded'>(() => {
    if (typeof window === 'undefined') return 'compact';
    const stored = window.localStorage.getItem(memViewStorageKey);
    return stored === 'expanded' ? 'expanded' : 'compact';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(memViewStorageKey, memView);
    }
  }, [memView, memViewStorageKey]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Load memories (also acts as auth probe) ─────────────────────────
  const loadMemories = useCallback(async () => {
    const res = await fetch(`/api/brand/${brandId}/concierge/memories?limit=50`);
    if (res.status === 401 || res.status === 403) {
      setAuthState('denied');
      setDeniedReason(res.status === 401 ? 'Sign in to continue.' : `You are not authorized to manage ${brandName}.`);
      return;
    }
    if (!res.ok) {
      setAuthState('denied');
      setDeniedReason(`Unexpected response (${res.status}).`);
      return;
    }
    const data = await res.json();
    setMemories(data.memories ?? []);
    setAuthState('ok');
  }, [brandId, brandName]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Msg[] = [...messages, { role: 'user', content: text, at: Date.now() }];
    setMessages(next);
    setInput('');
    setSending(true);

    try {
      const res = await fetch(`/api/brand/${brandId}/concierge/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          sessionId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMessages([...next, { role: 'assistant', content: `Error: ${err.error ?? res.status}`, at: Date.now() }]);
        return;
      }
      const data = await res.json();
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: data.reply || '(no reply)',
          toolCalls: data.toolCalls ?? [],
          at: Date.now(),
        },
      ]);

      const hasWrite = (data.toolCalls ?? []).some(
        (c: ToolCall) => c.name === 'store_brand_memory' || c.name === 'expire_brand_memory',
      );
      if (hasWrite) loadMemories();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setMessages([...next, { role: 'assistant', content: `Error: ${err}`, at: Date.now() }]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (authState === 'checking') {
    return (
      <div className={embedded ? 'h-[calc(100vh-14rem)] min-h-[520px] bg-neutral-50 text-neutral-900 flex items-center justify-center border border-neutral-200 rounded-lg' : 'h-screen bg-neutral-50 text-neutral-900 flex items-center justify-center'}>
        <p className="font-mono text-neutral-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className={embedded ? 'h-[calc(100vh-14rem)] min-h-[520px] bg-neutral-50 text-neutral-900 flex items-center justify-center px-6 border border-neutral-200 rounded-lg' : 'h-screen bg-neutral-50 text-neutral-900 flex items-center justify-center px-6'}>
        <div className="max-w-md text-center">
          <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-neutral-600 mb-3">Access denied</h1>
          <p className="text-neutral-800 mb-6">{deniedReason}</p>
          <div className="flex gap-3 justify-center text-xs font-mono">
            <a href="/admin/rrg" className="text-neutral-600 hover:text-neutral-900 underline">RRG admin login</a>
            <span className="text-neutral-400">|</span>
            <a href={`/brand/${brandSlug}/login`} className="text-neutral-600 hover:text-neutral-900 underline">Brand login</a>
          </div>
        </div>
      </div>
    );
  }

  const filtered = memFilter === 'all' ? memories : memories.filter((m) => m.type === memFilter);

  return (
    <div className={rootClass}>
      {/* Header,  hidden in embedded mode (the brand-admin tab bar is the header) */}
      {!embedded && (
        <header className="bg-white border-b border-neutral-200 px-6 py-4 flex justify-between items-center">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-900">
              {brandName} · Concierge
            </span>
            {brandHeadline && <span className="text-xs text-neutral-500 hidden md:inline">{brandHeadline}</span>}
          </div>
          <a href="/admin/rrg" className="text-xs text-neutral-600 hover:text-neutral-900 transition-colors font-mono">
            ← Admin
          </a>
        </header>
      )}

      {/* Body: chat + memory sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Chat column */}
        <section className="flex-1 flex flex-col min-w-0">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-6"
          >
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-neutral-500 font-mono text-xs border border-dashed border-neutral-300 rounded p-4">
                  Tell your concierge about an event, promotion, stock note, or brand update.
                  It will extract the facts, confirm with a &quot;Locked in:&quot; line, and store it so the Telegram concierge surfaces it to customers.
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
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1 text-left">
                      {m.toolCalls.map((tc, j) => (
                        <details key={j} className="text-xs font-mono text-neutral-600">
                          <summary className="cursor-pointer hover:text-neutral-900">
                            tool: {tc.name}
                          </summary>
                          <pre className="mt-1 p-2 bg-white border border-neutral-200 rounded overflow-x-auto text-neutral-800">
{JSON.stringify(tc.input, null, 2)}

{tc.result}
                          </pre>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="text-neutral-500 font-mono text-xs">thinking...</div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="bg-white border-t border-neutral-200 px-6 py-4">
            <div className="max-w-3xl mx-auto">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Message ${brandName} Concierge. Ctrl/Cmd+Enter to send.`}
                rows={3}
                className="w-full bg-white border border-neutral-300 focus:border-neutral-900 outline-none
                           px-4 py-3 text-sm resize-none font-sans text-neutral-900 placeholder:text-neutral-400 rounded"
                disabled={sending}
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-neutral-500 font-mono">session {sessionId.slice(0, 8)}</span>
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
        </section>

        {/* Memories sidebar */}
        <aside className="hidden md:flex w-96 bg-white border-l border-neutral-200 flex-col min-h-0">
          <div className="border-b border-neutral-200 px-4 py-3 flex items-center justify-between gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-700">
              Live memories · {memories.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMemView(memView === 'compact' ? 'expanded' : 'compact')}
                aria-pressed={memView === 'expanded'}
                title={memView === 'compact' ? 'Show full memory bodies' : 'Show titles only'}
                className="text-[10px] font-mono uppercase tracking-wider border border-neutral-300 text-neutral-700 hover:border-neutral-500 hover:text-neutral-900 px-2 py-1 rounded"
              >
                {memView === 'compact' ? 'Expand' : 'Compact'}
              </button>
              <select
                value={memFilter}
                onChange={(e) => setMemFilter(e.target.value)}
                className="bg-white border border-neutral-300 text-xs font-mono text-neutral-900 px-2 py-1 rounded"
              >
                <option value="all">All</option>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {filtered.length === 0 && (
              <p className="text-neutral-500 text-xs font-mono">No memories yet.</p>
            )}
            {filtered.map((m) => (
              <div key={m.id} className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <span className="font-mono uppercase tracking-wider text-neutral-600 text-[10px]">
                    {TYPE_LABEL[m.type] ?? m.type}
                  </span>
                  {m.valid_until && (
                    <span className="text-neutral-500 text-[10px]">
                      until {new Date(m.valid_until).toISOString().slice(0, 10)}
                    </span>
                  )}
                </div>
                <div className={`text-neutral-900 font-medium ${memView === 'expanded' ? 'mb-1' : ''}`}>{m.title}</div>
                {memView === 'expanded' && (
                  <>
                    <div className="text-neutral-700 leading-relaxed">{m.body}</div>
                    {m.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.tags.map((t) => (
                          <span key={t} className="text-[10px] font-mono text-neutral-600 bg-white border border-neutral-200 px-1.5 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
