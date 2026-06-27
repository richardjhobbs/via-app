import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies } from '@/lib/app/seller-auth';
import { acceptInvite } from '@/lib/app/seller-team';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/seller/invite/accept : accept a team invite.
 * Body { token, password }. Creates/links the account, adds the membership,
 * sets the brand auth cookies and returns the seller slug to redirect to.
 */
export async function POST(req: NextRequest) {
  if (isRateLimited(`seller-invite-accept|${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute and try again.' }, { status: 429 });
  }

  let body: { token?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const token    = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!token) return NextResponse.json({ error: 'Missing invitation token' }, { status: 400 });

  const result = await acceptInvite(token, password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const response = NextResponse.json({
    ok: true,
    redirect_to: `/seller/${result.sellerSlug}/admin`,
  });
  setBrandAuthCookies(response, result.accessToken, result.refreshToken);
  return response;
}
