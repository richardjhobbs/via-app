import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSessionAgent } from '@/lib/agent/auth';

export const dynamic = 'force-dynamic';

/** GET /api/agent/session — Get current agent from session cookie, then
 *  fall back to wallet, then email. Used by the dashboard to recover a
 *  session after the user logs back in (the same email may produce a
 *  different Thirdweb embedded wallet across sign-in methods). */
export async function GET(req: NextRequest) {
  // Try cookie first
  const agent = await getSessionAgent();
  if (agent) {
    return NextResponse.json({ agent: { ...agent, via_agent_id: agent.erc8004_agent_id } });
  }

  // Fallback 1: wallet
  const wallet = req.nextUrl.searchParams.get('wallet')?.toLowerCase();
  if (wallet) {
    const { data } = await db
      .from('agent_agents')
      .select('*')
      .eq('wallet_address', wallet)
      .single();

    if (data) {
      return setSessionAndRespond(data);
    }
  }

  // Fallback 2: email (covers cross-login-method recovery — email is the
  // user's stable identity, even when Thirdweb produces a different
  // embedded wallet for a different sign-in path).
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (email) {
    const { data } = await db
      .from('agent_agents')
      .select('*')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      return setSessionAndRespond(data);
    }
  }

  return NextResponse.json({ error: 'No active session' }, { status: 401 });
}

function setSessionAndRespond(agent: { id: string; erc8004_agent_id: number | null } & Record<string, unknown>) {
  const response = NextResponse.json({ agent: { ...agent, via_agent_id: agent.erc8004_agent_id } });
  response.cookies.set('via_agent_session', agent.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  return response;
}

/** DELETE /api/agent/session — Sign out */
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
