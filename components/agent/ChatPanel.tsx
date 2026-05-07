'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TIER_DISPLAY } from '@/lib/agent/types';
import { CHAT_COST_ESTIMATE } from '@/lib/agent/credits';
import type { Agent } from '@/lib/agent/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface Props {
  agent: Agent;
}

export function ChatPanel({ agent }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [evalMode, setEvalMode] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content (1–8 lines, then scrolls)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const tierLabel = TIER_DISPLAY[agent.tier].label;

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function newConversation() {
    setMessages([]);
    setSessionId(crypto.randomUUID());
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    // Add placeholder for assistant
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

    try {
      const res = await fetch(`/api/agent/${agent.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          is_eval_preview: evalMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: `Error: ${data.error || 'Chat failed'}`,
          };
          return updated;
        });
        setSending(false);
        return;
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No stream');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const text = JSON.parse(data) as string;
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = {
                ...last,
                content: last.content + text,
              };
              return updated;
            });
          } catch {
            // ignore parse errors
          }
        }
      }

      // Mark streaming complete
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          streaming: false,
        };
        return updated;
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Connection error. Please try again.',
        };
        return updated;
      });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (agent.tier !== 'pro') return null;

  return (
    <Card className="md:col-span-2">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
            Chat with {agent.name}
          </h2>
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>{open ? '▲' : '▼'}</span>
        </button>
        <span style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {CHAT_COST_ESTIMATE[agent.llm_provider] ?? '~$0.003'} per message
          <span style={{ position: 'relative' }} className="group">
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: 99,
              border: '1px solid var(--line-strong)', fontSize: 9, color: 'var(--ink-3)',
              cursor: 'help',
            }}>?</span>
            <span style={{
              position: 'absolute', bottom: '100%', right: 0, marginBottom: 4,
              width: 192, padding: 8, fontSize: 10, color: 'var(--ink-2)',
              background: 'var(--paper)', border: '1px solid var(--line-strong)',
              opacity: 0, pointerEvents: 'none',
            }} className="group-hover:opacity-100">
              Estimate only, charged by LLM provider.
            </span>
          </span>
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 16 }}>
          {/* Controls bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setEvalMode(!evalMode)}
                className={`chip ${evalMode ? 'is-active' : ''}`}
                style={{ padding: '4px 12px', fontSize: 10 }}
              >
                {evalMode ? 'Eval mode on' : 'Eval mode'}
              </button>
              {evalMode && (
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  Describe a drop to get your {tierLabel}&apos;s evaluation.
                </span>
              )}
            </div>
            <button
              onClick={newConversation}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              New conversation
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              height: 320, overflowY: 'auto',
              border: '1px solid var(--line)', background: 'var(--bg-2)',
              padding: 14, marginBottom: 12,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            {messages.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ textAlign: 'center', maxWidth: 320 }}>
                  <p style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 16, color: 'var(--ink-2)', margin: '0 0 10px', lineHeight: 1.5 }}>
                    Say hello to {agent.name}.
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
                    Your {tierLabel} will learn your style and taste as you converse.
                    Share brands and pieces that interest you, and {agent.name} will be more selective on your behalf.
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
              >
                <div
                  className={msg.role === 'assistant' ? 'agent-md' : undefined}
                  style={{
                    maxWidth: '82%',
                    padding: '10px 14px',
                    fontSize: 14,
                    lineHeight: 1.5,
                    ...(msg.role === 'user'
                      ? {
                          background: 'var(--ink)', color: 'var(--bg)',
                          borderRadius: '14px 14px 4px 14px',
                        }
                      : {
                          background: 'var(--paper)', color: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '14px 14px 14px 4px',
                          fontFamily: 'var(--font-fraunces), serif',
                          letterSpacing: '-0.005em',
                        }),
                  }}
                >
                  {msg.role === 'assistant' ? (
                    msg.content ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                              {children}
                            </a>
                          ),
                          p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
                          ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
                          ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
                          li: ({ children }) => <li style={{ margin: '0 0 2px' }}>{children}</li>,
                          strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : msg.streaming ? '…' : ''
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  )}
                  {msg.streaming && msg.content && (
                    <span style={{ display: 'inline-block', width: 6, height: 14, background: 'currentColor', opacity: 0.5, marginLeft: 2, animation: 'cc-pulse 1s infinite' }} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={evalMode ? 'Describe a drop to evaluate…' : `Message ${agent.name}…`}
              disabled={sending}
              style={{
                flex: 1,
                background: 'var(--paper)',
                border: '1px solid var(--line-strong)',
                padding: '10px 14px',
                fontSize: 14,
                lineHeight: 1.5,
                fontFamily: 'inherit',
                color: 'var(--ink)',
                outline: 'none',
                opacity: sending ? 0.55 : 1,
                resize: 'none',
                minHeight: 42,
                maxHeight: 200,
                overflowY: 'auto',
                wordBreak: 'break-word',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ink)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
            />
            <Button size="sm" onClick={send} loading={sending} disabled={!input.trim()}>
              Send
            </Button>
          </div>

          {/* Credit info */}
          <div style={{
            marginTop: 8,
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--ink-3)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Credits: ${Number(agent.credit_balance_usdc ?? 0).toFixed(2)}</span>
            <span>{agent.llm_provider}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
