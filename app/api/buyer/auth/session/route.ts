import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getUserBrands } from '@/lib/app/seller-auth';
import { setBuyerAuthCookies, getUserBuyers } from '@/lib/app/buyer-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/buyer/auth/session : exchange Supabase session tokens (from a
 * magic-link redirect hash) for the app's auth cookies. The access token is
 * validated against Supabase before anything is set.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const access = String(body.access_token ?? '');
    const refresh = String(body.refresh_token ?? '');
    if (!access || !refresh) return NextResponse.json({ error: 'tokens required' }, { status: 400 });

    const { data, error } = await supabaseAdmin.auth.getUser(access);
    if (error || !data.user) return NextResponse.json({ error: 'invalid session' }, { status: 401 });

    // One credential covers buyer and seller (same cookies); return both so
    // the login page can route to whichever the user actually owns.
    const [buyers, sellers] = await Promise.all([
      getUserBuyers(data.user.id),
      getUserBrands(data.user.id).catch(() => []),
    ]);
    const response = NextResponse.json({
      authenticated: true,
      user: { id: data.user.id, email: data.user.email },
      buyers,
      sellers,
    });
    setBuyerAuthCookies(response, access, refresh);
    return response;
  } catch (err) {
    console.error('[/api/buyer/auth/session]', err);
    return NextResponse.json({ error: 'could not establish the session' }, { status: 500 });
  }
}
