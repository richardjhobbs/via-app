'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  buyerId: string;
  handle: string;
  displayName: string;
  seedGreeting: string;
}

interface ToolCall {
  name: string;
  input: unknown;
  result: string;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface Memory {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
}

const WRITE_TOOLS = ['store_buyer_memory', 'update_buyer_memory', 'forget_buyer_memory'];

export function BuyingAgentChatClient({ buyerId, handle, displayName, seedGreeting }: Props) {
  const [turns, setTurns]       = useState<Turn[]>([{ role: 'assistant', content: seedGreeting }]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [err, setErr]           = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [sessionId]             = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Math.random().toString(36).slice(2)}-${Date.now()}`
  );

  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  async function refreshMemories() {
    try {
      const res = await fetch(`/api/buyer/${buyerId}/buying-agent/memories?limit=20`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.memories)) setMemories(json.memories);
    } catch {
      // silent — preference panel is non-critical
    }
  }

  useEffect(() => {
    refreshMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerId]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setErr('');
    setSending(true);

    const nextTurns: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(nextTurns);
    setInput('');

    try {
      const payload = {
        sessionId,
        messages: nextTurns
          .filter((t) => t.role === 'user' || t.role === 'assistant')
          .map((t) => ({ role: t.role, content: t.content })),
      };
      const res = await fetch(`/api/buyer/${buyerId}/buying-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Request failed (${res.status})`);
        setSending(false);
        return;
      }
      setTurns([
        ...nextTurns,
        { role: 'assistant', content: json.reply || '(no reply)', toolCalls: json.toolCalls ?? [] },
      ]);
      if (json.toolCalls?.some((c: ToolCall) => WRITE_TOOLS.includes(c.name))) {
        await refreshMemories();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
      <div className="bg-white border border-neutral-200 rounded-lg shadow-sm">
        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-5">
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'pl-12' : 'pr-12'}>
              <div className="text-[10px] font-mono tracking-widest uppercase text-neutral-400 mb-1">
                {t.role === 'user' ? 'You' : `@${handle} agent`}
              </div>
              <div className={`text-sm whitespace-pre-wrap leading-relaxed ${t.role === 'user' ? 'text-neutral-900' : 'text-neutral-800'}`}>
                {t.content}
              </div>
              {t.toolCalls && t.toolCalls.length > 0 && (
                <details className="mt-2 text-[11px] font-mono text-neutral-500">
                  <summary className="cursor-pointer hover:text-neutral-800">
                    {t.toolCalls.length} tool call{t.toolCalls.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-2 pl-3 border-l border-neutral-200">
                    {t.toolCalls.map((c, j) => (
                      <li key={j}>
                        <div className="text-neutral-700">{c.name}</div>
                        <div className="text-neutral-500 break-all">{c.result}</div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
          {sending && (
            <div className="pr-12">
              <div className="text-[10px] font-mono tracking-widest uppercase text-neutral-400 mb-1">
                @{handle} agent
              </div>
              <div className="text-sm text-neutral-400">thinking&hellip;</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-neutral-200 p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={`Tell your agent what you want, what you will not buy, your budget. Enter to send, Shift+Enter for newline.`}
            rows={3}
            disabled={sending}
            className="w-full bg-neutral-50 border border-neutral-300 rounded-md px-3 py-2 text-sm font-sans outline-none focus:border-neutral-900 transition-colors disabled:opacity-50"
          />
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
              session {sessionId.slice(0, 8)}
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="px-4 py-2 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      <aside className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-mono tracking-widest uppercase text-neutral-500">Locked-in preferences</p>
          <button
            type="button"
            onClick={() => void refreshMemories()}
            className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-neutral-900"
          >
            Refresh
          </button>
        </div>
        {memories.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Nothing locked in yet. Tell the agent something above and it will appear here.
          </p>
        ) : (
          <ul className="space-y-3 max-h-[55vh] overflow-y-auto">
            {memories.map((m) => (
              <li key={m.id} className="border-b border-neutral-100 pb-3 last:border-b-0">
                <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-1">{m.type}</div>
                <div className="text-xs font-medium text-neutral-900 mb-1">{m.title}</div>
                <div className="text-xs text-neutral-600 leading-relaxed">{m.body}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] font-mono text-neutral-400 mt-4 leading-relaxed">
          When your profile is public, seller agents read a PII-safe slice of these at{' '}
          <code>/buyers/{handle}/mcp</code>.
        </p>
      </aside>
    </div>
  );
}
