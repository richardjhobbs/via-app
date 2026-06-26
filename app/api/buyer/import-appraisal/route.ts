import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { insertNotification } from '@/lib/app/notifications';
import { verifyMindLinkToken } from '@/lib/app/minds-link';
import { PreferenceAppraisalSchema, importPreferenceAppraisal } from '@/lib/app/minds-appraisal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

/**
 * POST /api/buyer/import-appraisal , a Minds agent pushes a shopping-preference
 * appraisal it derived from the owner's email.
 *
 * Body: { link_token: string, appraisal: PreferenceAppraisal }
 *
 * The link_token (minted by the owner in their VIA dashboard, signed with
 * VIA_PLATFORM_SECRET) is the authorisation: it scopes the write to exactly one
 * buyer. VIA never receives raw email , only the structured appraisal. This is
 * the REST surface; the central MCP exposes the same thing as the
 * import_preference_appraisal tool. Works whether or not the buyer is public.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const token = String(body.link_token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'missing link_token' }, { status: 400 });

  const verified = verifyMindLinkToken(token);
  if (!verified.ok) return NextResponse.json({ error: `invalid link token: ${verified.error}` }, { status: 401 });

  const parsed = PreferenceAppraisalSchema.safeParse(body.appraisal);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid appraisal', issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  // The buyer must still exist and match the handle the token was minted for.
  const { data: buyer } = await db
    .from('app_buyers')
    .select('id, handle, owner_user_id')
    .eq('id', verified.payload.buyer_id)
    .maybeSingle();
  if (!buyer || buyer.handle !== verified.payload.handle) {
    return NextResponse.json({ error: 'buyer not found for this token' }, { status: 404 });
  }

  let result;
  try {
    result = await importPreferenceAppraisal(buyer.id as string, parsed.data);
  } catch (err) {
    console.error('[import-appraisal] import failed:', err);
    return NextResponse.json({ error: 'failed to import appraisal' }, { status: 500 });
  }

  const reviewUrl = `/buyer/${buyer.handle}/admin/buying-agent`;
  const hasProposedCaps = Object.keys(result.proposedCaps).length > 0;

  void insertNotification({
    ownerUserId: buyer.owner_user_id as string,
    kind:        'system',
    title:       'Your Mind appraised your shopping preferences',
    body:        hasProposedCaps
      ? `${result.inserted + result.updated} preference signal(s) imported, plus proposed spending caps awaiting your approval.`
      : `${result.inserted + result.updated} preference signal(s) imported from your email appraisal.`,
    link:        reviewUrl,
    metadata:    { source: 'minds-email', buyer_id: buyer.id, ...result },
  });

  return NextResponse.json({
    ok:           true,
    buyer:        { handle: buyer.handle },
    imported:     { inserted: result.inserted, updated: result.updated },
    proposed_caps: hasProposedCaps ? result.proposedCaps : null,
    review_url:   `${APP_BASE}${reviewUrl}`,
    next: hasProposedCaps
      ? 'Preferences imported. Proposed spending caps are waiting for the owner to approve in the dashboard before they take effect.'
      : 'Preferences imported onto the buying agent.',
  });
}
