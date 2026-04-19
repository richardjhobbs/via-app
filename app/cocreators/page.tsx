import type { Metadata } from 'next';
import Link from 'next/link';
import { getOpenBriefs, getAllActiveBrands } from '@/lib/rrg/db';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Co-creators, Real Real Genuine',
  description:
    'Admitted brands publish open briefs. Approved work becomes a limited edition, on-chain, with revenue shared automatically.',
};

export default async function CoCreatorsPage() {
  const [openBriefs, allBrands] = await Promise.all([
    getOpenBriefs(),
    getAllActiveBrands(),
  ]);
  const brandMap = new Map(allBrands.map((b) => [b.id, b]));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="cocreators" />

      <main>
        {/* ─── Intro ────────────────────────────────────────────────────── */}
        <section className="page-pad" style={{ maxWidth: 1040, paddingTop: 24 }}>
          <div className="section-note" style={{ marginBottom: 8 }}>§ Co-creators</div>
          <h1
            style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontWeight: 400,
              fontSize: 'clamp(40px, 6vw, 72px)',
              letterSpacing: '-0.02em',
              lineHeight: 1.02,
              margin: '0 0 24px',
            }}
          >
            Creative briefs,<br/><em>open to you.</em>
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              color: 'var(--ink-2)',
              maxWidth: '62ch',
              margin: '0 0 18px',
              fontWeight: 300,
            }}
          >
            Admitted brands on RRG publish open briefs: a reference, a feeling, a
            direction. Photographers, stylists, illustrators and designers respond
            with their own interpretation.
          </p>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              color: 'var(--ink-2)',
              maxWidth: '62ch',
              margin: '0 0 18px',
              fontWeight: 300,
            }}
          >
            Approved work becomes a limited edition, minted on Base, sold through the
            store. Revenue is split automatically between the brand, the creator and
            the platform. No invoices, no chasing, no intermediaries.
          </p>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              color: 'var(--ink-2)',
              maxWidth: '62ch',
              margin: '0 0 32px',
              fontWeight: 300,
            }}
          >
            Co-creation is how the catalogue grows. Quietly, with people whose taste
            and craft we already trust.
          </p>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 48 }}>
            <Link
              href="/creator"
              className="btn"
              style={{ textDecoration: 'none' }}
            >
              Apply as a creator <span className="arrow">→</span>
            </Link>
            <Link
              href="/create"
              className="btn ghost"
              style={{ textDecoration: 'none' }}
            >
              Launch a brief as a brand
            </Link>
          </div>
        </section>

        {/* ─── How it works ─────────────────────────────────────────────── */}
        <section
          className="page-pad"
          style={{
            maxWidth: 1040,
            paddingTop: 40,
            paddingBottom: 40,
            borderTop: '1px solid var(--line)',
          }}
        >
          <div className="section-note" style={{ marginBottom: 24 }}>§ How it works</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 32,
            }}
          >
            <div>
              <div
                className="uc-mono"
                style={{ color: 'var(--accent)', marginBottom: 8, fontSize: 11, letterSpacing: '0.12em' }}
              >
                Step 01
              </div>
              <h4
                style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontWeight: 400,
                  fontSize: 20,
                  margin: '0 0 8px',
                }}
              >
                A brand posts <em>a brief.</em>
              </h4>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)', fontWeight: 300, margin: 0 }}>
                Direction, references, deadline. What they are looking for, in their
                own language.
              </p>
            </div>
            <div>
              <div
                className="uc-mono"
                style={{ color: 'var(--accent)', marginBottom: 8, fontSize: 11, letterSpacing: '0.12em' }}
              >
                Step 02
              </div>
              <h4
                style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontWeight: 400,
                  fontSize: 20,
                  margin: '0 0 8px',
                }}
              >
                Creators <em>respond.</em>
              </h4>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)', fontWeight: 300, margin: 0 }}>
                Submit a single piece or a small body of work. Your own
                interpretation, not a template.
              </p>
            </div>
            <div>
              <div
                className="uc-mono"
                style={{ color: 'var(--accent)', marginBottom: 8, fontSize: 11, letterSpacing: '0.12em' }}
              >
                Step 03
              </div>
              <h4
                style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontWeight: 400,
                  fontSize: 20,
                  margin: '0 0 8px',
                }}
              >
                Approved work <em>becomes an edition.</em>
              </h4>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)', fontWeight: 300, margin: 0 }}>
                The brand approves, we mint. A limited edition on Base, listed in the
                store, with revenue split on every sale.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Live briefs ──────────────────────────────────────────────── */}
        <section
          className="page-pad"
          style={{
            maxWidth: 1040,
            paddingTop: 40,
            paddingBottom: 96,
            borderTop: '1px solid var(--line)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: 16,
              marginBottom: 28,
            }}
          >
            <div>
              <div className="section-note" style={{ marginBottom: 8 }}>§ Live briefs</div>
              <h2
                style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontWeight: 400,
                  fontSize: 'clamp(28px, 3vw, 40px)',
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                Open <em>right now.</em>
              </h2>
            </div>
            <div
              className="uc-mono"
              style={{ color: 'var(--ink-3)', fontSize: 11, letterSpacing: '0.12em' }}
            >
              {openBriefs.length} {openBriefs.length === 1 ? 'brief' : 'briefs'} open
            </div>
          </div>

          {openBriefs.length === 0 ? (
            <div
              className="empty-state"
              style={{
                padding: '48px 0',
                textAlign: 'center',
                color: 'var(--ink-2)',
                fontSize: 15,
              }}
            >
              No open briefs right now. New briefs land weekly, apply as a creator to
              get first look.
            </div>
          ) : (
            <div style={{ borderTop: '1px solid var(--line)' }}>
              {openBriefs.map((b, i) => {
                const brand = b.brand_id ? brandMap.get(b.brand_id) : null;
                const deadline = b.ends_at
                  ? new Date(b.ends_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })
                  : 'Rolling';
                const href = brand?.slug ? `/brand/${brand.slug}` : '/rrg';
                return (
                  <Link
                    key={b.id}
                    href={href}
                    className="open-brief-row"
                    style={{
                      display: 'block',
                      padding: '24px 0',
                      borderBottom: '1px solid var(--line)',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <span className="uc-mono" style={{ color: 'var(--accent)' }}>
                        Brief {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>
                        Closes {deadline}
                      </span>
                    </div>
                    <h4
                      style={{
                        fontFamily: 'var(--font-fraunces), serif',
                        fontWeight: 400,
                        fontSize: 24,
                        letterSpacing: '-0.01em',
                        lineHeight: 1.15,
                        margin: '0 0 6px',
                      }}
                    >
                      {brand?.name && (
                        <em style={{ fontStyle: 'italic', color: 'var(--ink-2)', fontWeight: 300 }}>
                          {brand.name},{' '}
                        </em>
                      )}
                      {b.title}
                    </h4>
                    <p
                      style={{
                        fontSize: 14,
                        color: 'var(--ink-2)',
                        lineHeight: 1.55,
                        margin: '0 0 10px',
                        maxWidth: '70ch',
                        fontWeight: 300,
                      }}
                    >
                      {truncate(b.description, 220)}
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontFamily: 'var(--font-jetbrains), monospace',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-3)',
                      }}
                    >
                      <span>{b.response_count} creators responding</span>
                      <span>Read the brief →</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <RRGFooter />
    </div>
  );
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
