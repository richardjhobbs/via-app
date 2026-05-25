import { NextRequest, NextResponse } from 'next/server';
import { issueSignInLink } from '@/lib/agent/auth-email';
import { sendSignInLink } from '@/lib/agent/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/auth/email/request
 *
 * Body: { email: string }
 *
 * Sends a one-shot sign-in link to the address IF it matches a known
 * agent. Always returns 200 with the same shape regardless of whether
 * the email was found, so the endpoint cannot be used to enumerate
 * registered accounts. The actual sign-in happens at
 * /agents/auth/email/verify?token=... when the user clicks the link.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const email = typeof body.email === 'string' ? body.email : '';

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null;
  const userAgent = req.headers.get('user-agent');

  try {
    const result = await issueSignInLink(email, { ip, userAgent });
    if (result.issued && result.rawToken && result.agent) {
      // Email send is best-effort relative to the response: we already
      // committed the token, so we send the email synchronously to make
      // delivery failures observable in logs. The endpoint itself still
      // returns 200 to keep account existence private.
      try {
        await sendSignInLink(result.agent.email, result.agent.name, result.rawToken);
      } catch (err) {
        console.error('[auth/email/request] send failed:', err);
      }
    }
  } catch (err) {
    console.error('[auth/email/request] issue failed:', err);
  }

  // Constant-shape response. Do NOT leak whether the email was found.
  return NextResponse.json({ ok: true }, { status: 200 });
}
