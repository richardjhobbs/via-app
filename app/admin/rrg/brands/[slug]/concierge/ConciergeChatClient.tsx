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
}

const TYPE_LABEL: Record<string, string> = {
  event: 'Event',
  stock_note: 'Stock',
  promotion: 'Promo',
  brand_update: 'Update',
  policy: 'Policy',
  general: 'General',
};

export default function ConciergeChatClient({ brandId, brandSlug, brandName, brandHeadline }: Props) {
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [deniedReason, setDeniedReason] = useState<string>('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memFilter, setMemFilter] = useState<'all' | string>('all');
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

  // ── Auto-scroll chat ────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // ── Send a message ──────────────────────────────────────────────────
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

      // Refresh memory sidebar if any write happened
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
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="font-mono text-white/50 text-sm">Loading…</p>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-3">Access denied</h1>
          <p className="text-white/80 mb-6">{deniedReason}</p>
          <div className="flex gap-3 justify-center text-xs font-mono">
            <a href="/admin/rrg" className="text-white/50 hover:text-white">RRG admin login</a>
            <span className="text-white/20">·</span>
            <a href={`/brand/${brandSlug}/login`} className="text-white/50 hover:text-white">Brand login</a>
          </div>
        </div>
      </div>
    );
  }

  const filtered = memFilter === 'all' ? memories : memories.filter((m) => m.type === memFilter);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex justify-between items-center">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-white/80">
            {brandName} · Concierge
          </span>
          {brandHeadline && <span className="text-xs text-white/40 hidden md:inline">{brandHeadline}</span>}
        </div>
        <a href="/admin/rrg" className="text-xs text-white/50 hover:text-white transition-colors font-mono">
          ← Admin
        </a>
      </header>

      {/* Body: chat + memory sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Chat column */}
        <section className="flex-1 flex flex-col min-w-0">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-6 space-y-4"
          >
            {messages.length === 0 && (
              <div className="text-white/40 font-mono text-xs">
                Tell your concierge about an event, promotion, stock note, or brand update.
                It will extract the facts, confirm with a &quot;Locked in:&quot; line, and store it so the Telegram concierge surfaces it to customers.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[85%] text-left whitespace-pre-wrap px-4 py-3 rounded ${
                    m.role === 'user'
                      ? 'bg-white text-black'
                      : 'bg-white/5 border border-white/10 text-white/90'
                  }`}
                >
                  {m.content}
                </div>
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {m.toolCalls.map((tc, j) => (
                      <details key={j} className="text-xs font-mono text-white/40">
                        <summary className="cursor-pointer hover:text-white/70">
                          tool: {tc.name}
                        </summary>
                        <pre className="mt-1 p-2 bg-white/5 border border-white/10 rounded overflow-x-auto">
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
              <div className="text-white/40 font-mono text-xs">thinking…</div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-white/10 px-6 py-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${brandName} Concierge — Ctrl/Cmd+Enter to send`}
              rows={3}
              className="w-full bg-transparent border border-white/20 focus:border-white outline-none
                         px-4 py-3 text-sm resize-none font-sans placeholder:text-white/40"
              disabled={sending}
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-white/40 font-mono">session {sessionId.slice(0, 8)}</span>
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                className="px-4 py-2 text-sm bg-white text-black disabled:bg-white/20 disabled:text-white/40 hover:bg-white/90 transition-all"
              >
                Send
              </button>
            </div>
          </div>
        </section>

        {/* Memories sidebar */}
        <aside className="hidden md:flex w-96 border-l border-white/10 flex-col min-h-0">
          <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/60">
              Live memories · {memories.length}
            </span>
            <select
              value={memFilter}
              onChange={(e) => setMemFilter(e.target.value)}
              className="bg-black border border-white/20 text-xs font-mono text-white/80 px-2 py-1"
            >
              <option value="all">All</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {filtered.length === 0 && (
              <p className="text-white/40 text-xs font-mono">No memories yet.</p>
            )}
            {filtered.map((m) => (
              <div key={m.id} className="border border-white/10 p-3 text-xs">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <span className="font-mono uppercase tracking-wider text-white/50 text-[10px]">
                    {TYPE_LABEL[m.type] ?? m.type}
                  </span>
                  {m.valid_until && (
                    <span className="text-white/40 text-[10px]">
                      until {new Date(m.valid_until).toISOString().slice(0, 10)}
                    </span>
                  )}
                </div>
                <div className="text-white/90 mb-1">{m.title}</div>
                <div className="text-white/60 leading-relaxed">{m.body}</div>
                {m.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.tags.map((t) => (
                      <span key={t} className="text-[10px] font-mono text-white/50 border border-white/10 px-1.5 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
