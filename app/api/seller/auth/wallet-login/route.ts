import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin, getUserBrands } from '@/lib/app/seller-auth';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/seller/auth/wallet-login
 *
 * Login via thirdweb Google OAuth — looks up seller ownership by email,
 * creates a Supabase session, returns owned seller rows.
 */
export async function POST(req: NextRequest) {
  try {
    const { wallet, email } = await req.json();

    if (!wallet || !email) {
      return NextResponse.json({ error: 'Wallet and email required' }, { status: 400 });
    }

    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const user = users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      return NextResponse.json(
        { error: 'No account found for this email. Please register first.' },
        { status: 403 },
      );
    }

    const brands = await getUserBrands(user.id);
    if (brands.length === 0) {
      return NextResponse.json(
        { error: 'No seller account found for this email. Please complete onboarding first.' },
        { status: 403 },
      );
    }

    const tempPassword = randomBytes(32).toString('base64url');
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: tempPassword,
    });
    if (updateErr) {
      return NextResponse.json({ error: 'Session creation failed' }, { status: 500 });
    }

    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: tempPassword,
    });
    if (signInErr || !signIn.session) {
      return NextResponse.json({ error: 'Session creation failed' }, { status: 500 });
    }

    const response = NextResponse.json({
      user: { id: user.id, email: user.email },
      brands,
    });

    setBrandAuthCookies(response, signIn.session.access_token, signIn.session.refresh_token);
    return response;
  } catch (err) {
    console.error('[/api/seller/auth/wallet-login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
