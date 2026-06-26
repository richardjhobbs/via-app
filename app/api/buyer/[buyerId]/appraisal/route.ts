import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { mintMindLinkToken } from '@/lib/app/minds-link';
import {
  getAppraisalReview,
  approveProposedCaps,
  rejectProposedCaps,
} from '@/lib/app/minds-appraisal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Owner-only review surface for the Minds email appraisal.
 *
 * GET  -> the imported preference memories + the proposed/live delegation caps.
 * POST -> { action: 'mint_link' | 'approve' | 'reject' }
 *   mint_link : issue a short-lived link token the owner pastes into their Mind
 *               so it can push an appraisal (POST /api/buyer/import-appraisal).
 *   approve   : promote the proposed caps to live delegation caps.
 *   reject    : discard the proposed caps (live caps untouched).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const review = await getAppraisalReview(buyerId);
  return NextResponse.json(review);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const action = String(body.action ?? '').trim();

  if (action === 'mint_link') {
    const { data: buyer } = await db
      .from('app_buyers')
      .select('handle')
      .eq('id', buyerId)
      .maybeSingle();
    if (!buyer) return NextResponse.json({ error: 'buyer not found' }, { status: 404 });

    const token = mintMindLinkToken(buyerId, buyer.handle as string);
    if (!token) return NextResponse.json({ error: 'linking is not configured on this deployment' }, { status: 503 });

    return NextResponse.json({
      ok: true,
      link_token: token,
      expires_in_seconds: 24 * 60 * 60,
      instructions:
        'Paste this token into your Mind (hellominds.ai) and ask it to appraise your shopping preferences from your email and send them to VIA. The token authorises your Mind to update this buying agent for the next 24 hours.',
    });
  }

  if (action === 'approve') {
    const merged = await approveProposedCaps(buyerId);
    if (!merged) return NextResponse.json({ ok: false, error: 'no proposed caps to approve' }, { status: 404 });
    return NextResponse.json({ ok: true, live_caps: merged });
  }

  if (action === 'reject') {
    const ok = await rejectProposedCaps(buyerId);
    if (!ok) return NextResponse.json({ ok: false, error: 'no proposed caps to reject' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action; expected mint_link, approve, or reject' }, { status: 400 });
}
