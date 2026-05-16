import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import { activateBrandConcierge } from '@/lib/rrg/brand-concierge-activation';

export const dynamic = 'force-dynamic';

// POST /api/rrg/admin/brands/invite. Invite a brand admin (super-admin only)
// Body: { brand_id, email, temp_password }
//
// Thin wrapper over activateBrandConcierge (the same path Stage-2 fires
// automatically). Kept so a super-admin can (re)invite with a chosen
// password and re-trigger the welcome email.
export async function POST(req: NextRequest) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  try {
    const { brand_id, email, temp_password } = await req.json();

    if (!brand_id || !email) {
      return NextResponse.json(
        { error: 'brand_id and email required' },
        { status: 400 },
      );
    }
    // temp_password is optional: when omitted the activation helper
    // generates a secure one and emails it. When supplied it must be valid.
    if (temp_password !== undefined && temp_password !== '' &&
        (typeof temp_password !== 'string' || temp_password.length < 8)) {
      return NextResponse.json(
        { error: 'temp_password must be at least 8 characters' },
        { status: 400 },
      );
    }

    const result = await activateBrandConcierge({
      brandId: brand_id,
      email,
      password: temp_password || undefined,
      reinvite: true,
    });

    if (result.status === 'failed') {
      const notFound = (result.error ?? '').includes('not found');
      return NextResponse.json(
        { error: result.error ?? 'activation failed' },
        { status: notFound ? 404 : 500 },
      );
    }
    if (result.status === 'skipped') {
      return NextResponse.json({ error: result.error ?? 'skipped' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      status: result.status, // 'activated' | 'already_active'
      userId: result.userId,
      emailed: result.emailed ?? false,
      message:
        result.status === 'already_active'
          ? `${email} already an admin for this brand (no email sent)`
          : `Invited ${email} as admin`,
    });
  } catch (err) {
    console.error('[/api/rrg/admin/brands/invite]', err);
    return NextResponse.json({ error: 'Failed to invite brand admin' }, { status: 500 });
  }
}
