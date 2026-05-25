import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSessionAgent } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/session
 *
 * Returns the current signed-in agent based ONLY on the httpOnly session
 * cookie. The query parameters ?wallet= and ?email= used to mint a cookie
 * directly from a lookup, which let anyone impersonate any agent by simply
 * knowing the email or wallet address. THAT FALLBACK HAS BEEN REMOVED.
 *
 * The remaining surface is intentionally minimal:
 *   - cookie present + valid -> 200 { agent }
 *   - ?wallet=X with no cookie -> 200 { exists: boolean } (read-only existence
 *     check, no agent details). The wizard uses this to decide whether to
 *     prompt the user to sign in vs continue registering. No cookie minted.
 *   - ?email=X with no cookie -> 200 { exists: boolean } (same shape, same
 *     read-only contract). Used by the wizard's email-blur preflight.
 *   - neither present -> 401.
 *
 * To actually sign in from email or a different device, use the magic-link
 * flow at POST /api/agent/auth/email/request.
 */
export async function GET(req: NextRequest) {
  const agent = await getSessionAgent();
  if (agent) {
    return NextResponse.json({ agent: { ...agent, via_agent_id: agent.erc8004_agent_id } });
  }

  // Read-only existence check by wallet. NO cookie minted, NO agent details
  // returned. The wizard uses this to decide whether to surface "you already
  // have an account, sign in with magic link" vs continue.
  const wallet = req.nextUrl.searchParams.get('wallet')?.toLowerCase();
  if (wallet) {
    const { data } = await db
      .from('agent_agents')
      .select('id')
      .eq('wallet_address', wallet)
      .maybeSingle();
    return NextResponse.json({ exists: !!data }, { status: 200 });
  }

  // Same contract for email.
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (email) {
    const { data } = await db
      .from('agent_agents')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    return NextResponse.json({ exists: !!data }, { status: 200 });
  }

  return NextResponse.json({ error: 'No active session' }, { status: 401 });
}

/** DELETE /api/agent/session. Sign out. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('via_agent_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
