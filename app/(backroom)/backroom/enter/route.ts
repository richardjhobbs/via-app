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
import { db } from '@/lib/app/db';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { setBuyerAuthCookies } from '@/lib/app/buyer-auth';
import { mintPasswordlessSession } from '@/lib/app/passwordless';

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

    // An IMPORTED concierge is the same agent as its VIA buyer, so entering
    // the Back Room from RRG opens the owner's full VIA session (the handoff
    // token, minted inside their RRG session, is the ownership proof). Only a
    // never-imported concierge stays a federated guest session.
    try {
      const { data: linked } = await db
        .from('app_buyers')
        .select('owner_user_id')
        .not('linked_rrg_agent_id', 'is', null)
        .ilike('wallet_address', p.wallet_address)
        .maybeSingle();
      const ownerId = (linked as { owner_user_id: string | null } | null)?.owner_user_id;
      if (ownerId) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(ownerId);
        const email = u?.user?.email;
        if (email) {
          const minted = await mintPasswordlessSession(email);
          if (minted) {
            setBuyerAuthCookies(response, minted.access, minted.refresh);
            return response;
          }
        }
      }
    } catch (e) {
      console.warn('[backroom/enter] linked-buyer session mint failed, falling back to concierge session:', e);
    }

    setConciergeSessionCookie(response, { ref: p.ref, wallet: p.wallet_address, name: p.name ?? null, exp: Math.floor(Date.now() / 1000) + WEEK });
    return response;
  }

  return fail(concierge.error);
}
