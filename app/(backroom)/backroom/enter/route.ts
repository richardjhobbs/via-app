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
import { verifyConciergeHandoffToken } from '@/lib/app/backroom/concierge-handoff';
import { setConciergeSessionCookie } from '@/lib/app/backroom/concierge-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WEEK = 60 * 60 * 24 * 7;

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? '';

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/backroom?enter=${encodeURIComponent(reason)}`, origin));

  if (!token) return fail('missing');

  // A brand (rrg/seller) handoff or a personal-concierge (rrg/buyer) handoff.
  const brand = verifyBrandHandoffToken(token);
  if (brand.ok) {
    const p = brand.payload;
    const response = NextResponse.redirect(new URL(p.room_id ? `/room/${p.room_id}` : '/backroom', origin));
    setBrandSessionCookie(response, { slug: p.slug, wallet: p.wallet_address, name: p.name ?? null, exp: Math.floor(Date.now() / 1000) + WEEK });
    return response;
  }

  const concierge = verifyConciergeHandoffToken(token);
  if (concierge.ok) {
    const p = concierge.payload;
    const response = NextResponse.redirect(new URL(p.room_id ? `/room/${p.room_id}` : '/backroom', origin));
    setConciergeSessionCookie(response, { ref: p.ref, wallet: p.wallet_address, name: p.name ?? null, exp: Math.floor(Date.now() / 1000) + WEEK });
    return response;
  }

  return fail(concierge.error);
}
