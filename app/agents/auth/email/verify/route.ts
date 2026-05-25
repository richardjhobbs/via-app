import { NextRequest, NextResponse } from 'next/server';
import { consumeSignInToken } from '@/lib/agent/auth-email';

export const dynamic = 'force-dynamic';

/**
 * GET /agents/auth/email/verify?token=<raw>
 *
 * Route handler (NOT a page) because Next.js 16 forbids cookies().set()
 * from a page server component. The previous page implementation crashed
 * with "Cookies can only be modified in a Server Action or Route Handler."
 *
 * Consumes the magic-link token, mints the session cookie, and redirects:
 *   - success    -> /agents/dashboard
 *   - expired    -> /agents/auth/email/expired?reason=expired
 *   - used       -> /agents/auth/email/expired?reason=used
 *   - invalid    -> /agents/auth/email/expired?reason=invalid
 *
 * The 302 from a route handler lets the cookie ride along, which is the
 * whole point of moving this out of the page layer.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const result = await consumeSignInToken(token);

  if (result.ok && result.agentId) {
    const dashboardUrl = new URL('/agents/dashboard', req.nextUrl.origin);
    const response = NextResponse.redirect(dashboardUrl, { status: 302 });
    response.cookies.set('via_agent_session', result.agentId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return response;
  }

  const expiredUrl = new URL('/agents/auth/email/expired', req.nextUrl.origin);
  expiredUrl.searchParams.set('reason', result.reason);
  return NextResponse.redirect(expiredUrl, { status: 302 });
}
