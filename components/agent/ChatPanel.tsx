'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Local prop types for the ReactMarkdown component overrides below. Typed
// explicitly rather than pulled from react-markdown's exports so the file
// type-checks without depending on that package's type surface.
type MdProps = { children?: ReactNode };
type MdAnchorProps = { href?: string; children?: ReactNode };
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatCredits } from '@/lib/agent/credit-display';
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content (1-8 lines, then scrolls)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
          is_eval_preview: false,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
          Chat with {agent.name}
        </h2>
      </div>

      <div style={{ marginTop: 16 }}>
        {/* Controls bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12 }}>
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
                <div style={{ textAlign: 'center', maxWidth: 420 }}>
                  <p style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 16, color: 'var(--ink-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
                    Say hello to {agent.name}.
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
                    The deeper and longer the conversation, the more credits are used.
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
                          a: ({ href, children }: MdAnchorProps) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                              {children}
                            </a>
                          ),
                          p: ({ children }: MdProps) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
                          ul: ({ children }: MdProps) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
                          ol: ({ children }: MdProps) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
                          li: ({ children }: MdProps) => <li style={{ margin: '0 0 2px' }}>{children}</li>,
                          strong: ({ children }: MdProps) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
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
              placeholder={`Message ${agent.name}…`}
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
            <span>Credits: {formatCredits(Number(agent.credit_balance_usdc ?? 0))}</span>
            <span>{agent.llm_provider}</span>
          </div>
      </div>
    </Card>
  );
}
