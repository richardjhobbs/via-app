import Link from 'next/link';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const dynamic = 'force-dynamic';

/**
 * /agents/auth/email/expired?reason=expired|used|invalid|missing
 *
 * Friendly landing page for failed magic-link consumption. The verify
 * route handler redirects here on any non-ok outcome so the user gets a
 * clear explanation and a path back to requesting a fresh link instead
 * of staring at a server error page.
 */
export default async function MagicLinkExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const headline =
    reason === 'expired' ? 'This sign-in link has expired.'
    : reason === 'used'  ? 'This sign-in link has already been used.'
    : 'This sign-in link is not valid.';

  return (
    <>
      <RRGHeader active="concierge" />
      <main className="page-pad" style={{ maxWidth: 720 }}>
        <div style={{ paddingTop: 48 }}>
          <h1
            style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontWeight: 300,
              fontSize: 'clamp(28px, 4vw, 40px)',
              letterSpacing: '-0.015em',
              margin: '0 0 16px',
              color: 'var(--ink)',
            }}
          >
            {headline}
          </h1>
          <p
            style={{
              fontSize: 15,
              color: 'var(--ink-2)',
              lineHeight: 1.6,
              margin: '0 0 28px',
              maxWidth: '52ch',
            }}
          >
            For your security, sign-in links work once and expire after 15 minutes.
            Request a new one from the sign-in page.
          </p>
          <Link
            href="/agents"
            className="btn accent"
            style={{ fontSize: 12, padding: '12px 24px', letterSpacing: '0.08em' }}
          >
            Request a new link <span className="arrow">→</span>
          </Link>
        </div>
      </main>
      <RRGFooter />
    </>
  );
}
