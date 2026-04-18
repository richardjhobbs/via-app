'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface OpenBriefSummary {
  id: string;
  title: string;
  description: string;
  response_count: number;
  ends_at: string | null;
  brand_name: string | null;
  brand_slug: string | null;
}

interface Props {
  briefs: OpenBriefSummary[];
}

/**
 * Open-briefs modal. Rendered on the landing §04 co-creators row as a
 * button that opens a Maison-styled modal listing every active brief.
 */
export default function OpenBriefsModal({ briefs }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--ink-2)',
          fontSize: 13,
          textDecoration: 'none',
          borderBottom: '1px solid var(--line-strong)',
          paddingBottom: 2,
          cursor: 'pointer',
          fontFamily: 'inherit',
          letterSpacing: '0.01em',
        }}
      >
        All open briefs ({briefs.length}) →
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--ink) 55%, transparent)',
            backdropFilter: 'blur(6px)',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--line-strong)',
              width: '100%',
              maxWidth: 780,
              maxHeight: '82vh',
              display: 'flex',
              flexDirection: 'column',
              color: 'var(--ink)',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '20px 28px',
              borderBottom: '1px solid var(--line)',
            }}>
              <div>
                <div className="section-note" style={{ marginBottom: 4 }}>§ 04, co-creators</div>
                <div style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontSize: 22,
                  fontWeight: 400,
                  letterSpacing: '-0.01em',
                }}>
                  All open briefs, <em>{briefs.length}</em>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-3)',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{
              overflowY: 'auto',
              flex: 1,
              padding: briefs.length ? 0 : '56px 28px',
            }}>
              {briefs.length === 0 ? (
                <div className="empty-state" style={{ padding: 0 }}>
                  No open briefs right now. Follow along, new briefs land weekly.
                </div>
              ) : (
                briefs.map((b, i) => {
                  const deadline = b.ends_at
                    ? new Date(b.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                    : 'Rolling';
                  const href = b.brand_slug ? `/brand/${b.brand_slug}` : '/rrg';
                  return (
                    <Link
                      key={b.id}
                      href={href}
                      onClick={() => setOpen(false)}
                      style={{
                        display: 'block',
                        padding: '24px 28px',
                        borderBottom: i < briefs.length - 1 ? '1px solid var(--line)' : 'none',
                        textDecoration: 'none',
                        color: 'inherit',
                        transition: 'background 0.15s',
                      }}
                      className="open-brief-row"
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                      }}>
                        <span className="uc-mono" style={{ color: 'var(--accent)' }}>
                          Brief {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>
                          Closes {deadline}
                        </span>
                      </div>
                      <h4 style={{
                        fontFamily: 'var(--font-fraunces), serif',
                        fontWeight: 400,
                        fontSize: 22,
                        letterSpacing: '-0.01em',
                        lineHeight: 1.15,
                        margin: '0 0 4px',
                      }}>
                        {b.brand_name && <em style={{ fontStyle: 'italic', color: 'var(--ink-2)', fontWeight: 300 }}>{b.brand_name}, </em>}
                        {b.title}
                      </h4>
                      <p style={{
                        fontSize: 14,
                        color: 'var(--ink-2)',
                        lineHeight: 1.55,
                        margin: '0 0 10px',
                        maxWidth: '62ch',
                        fontWeight: 300,
                      }}>
                        {truncate(b.description, 180)}
                      </p>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontFamily: 'var(--font-jetbrains), monospace',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-3)',
                      }}>
                        <span>{b.response_count} creators responding</span>
                        <span>Read the brief →</span>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
