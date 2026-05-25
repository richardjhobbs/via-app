import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { consumeSignInToken } from '@/lib/agent/auth-email';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const dynamic = 'force-dynamic';

/**
 * /agents/auth/email/verify?token=<raw>
 *
 * Server component. Consumes the magic-link token, mints the
 * via_agent_session httpOnly cookie, then redirects to the dashboard.
 * Tokens are single-use and expire 15 minutes after issue.
 *
 * On any failure (missing/invalid/expired/used token), renders an
 * inline page with a "Request a new link" link back to /agents. No
 * auto-action so a stale browser tab cannot loop on a dead token.
 */
export default async function VerifyEmailSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = await consumeSignInToken(token ?? '');

  if (result.ok && result.agentId) {
    const cookieJar = await cookies();
    cookieJar.set('via_agent_session', result.agentId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    redirect('/agents/dashboard');
  }

  const headline =
    result.reason === 'expired' ? 'This sign-in link has expired.'
    : result.reason === 'used'  ? 'This sign-in link has already been used.'
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
