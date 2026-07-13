/**
 * GET /backroom/enter?token=<brand handoff>
 *
 * The landing an RRG brand concierge reaches from the "Back Room" link on its
 * RRG dashboard. RRG mints a short-lived brand handoff token (brand-handoff.ts)
 * vouching that the bearer controls the brand; VIA verifies it, opens a brand
 * session (brand-session.ts), and drops the brand straight into the named room,
 * or onto the Back Room hub. No VIA login, no wallet signature: the RRG session
 * that produced the token is the proof.
 *
 * A brand is federated, never mirrored, so nothing is imported here. Joining a
 * room still happens through the operator console or an agent invitation; this
 * only establishes the session that makes those surfaces recognise the brand.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyBrandHandoffToken } from '@/lib/app/backroom/brand-handoff';
import { setBrandSessionCookie } from '@/lib/app/backroom/brand-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? '';

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/backroom?enter=${encodeURIComponent(reason)}`, origin));

  if (!token) return fail('missing');

  const verified = verifyBrandHandoffToken(token);
  if (!verified.ok) return fail(verified.error);
  const p = verified.payload;

  const dest = p.room_id ? `/room/${p.room_id}` : '/backroom';
  const response = NextResponse.redirect(new URL(dest, origin));
  setBrandSessionCookie(response, {
    slug: p.slug,
    wallet: p.wallet_address,
    name: p.name ?? null,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  });
  return response;
}
