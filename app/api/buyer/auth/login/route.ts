import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setBuyerAuthCookies, getUserBuyers } from '@/lib/app/buyer-auth';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

// POST /api/buyer/auth/login : buyer email/password login
export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(`buyer-login|${clientIp(req)}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Please wait a minute and try again.' }, { status: 429 });
    }

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    // One generic 401 for both bad credentials and valid-credentials-without-
    // profile, so the response never confirms a valid email + password pair.
    if (error || !data.session) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const buyers = await getUserBuyers(data.user.id);
    if (buyers.length === 0) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const response = NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
      buyers,
    });

    setBuyerAuthCookies(response, data.session.access_token, data.session.refresh_token);

    return response;
  } catch (err) {
    console.error('[/api/buyer/auth/login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
