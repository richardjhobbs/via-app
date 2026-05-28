import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin, getUserBrands } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
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
 * Login via thirdweb Google OAuth — looks up brand membership by email,
 * creates a session, returns brand info including approval status.
 */
export async function POST(req: NextRequest) {
  try {
    const { wallet, email } = await req.json();

    if (!wallet || !email) {
      return NextResponse.json({ error: 'Wallet and email required' }, { status: 400 });
    }

    // Find Supabase user by email
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const user = users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      return NextResponse.json(
        { error: 'No account found for this email. Please register first.' },
        { status: 403 },
      );
    }

    // Check brand memberships
    const brands = await getUserBrands(user.id);
    if (brands.length === 0) {
      // Check if they have a pending brand (getUserBrands only returns active brand joins)
      // Look directly at app_seller_members + app_sellers
      const { data: memberships } = await db
        .from('app_seller_members')
        .select(`
          role,
          brand:app_sellers!inner(id, name, slug, status)
        `)
        .eq('user_id', user.id);

      if (!memberships || memberships.length === 0) {
        return NextResponse.json(
          { error: 'No brand account found for this email. Please register first.' },
          { status: 403 },
        );
      }

      // They have a membership but brand might be pending
      const brandData = memberships[0].brand as unknown as Record<string, unknown>;
      if (brandData.status === 'pending') {
        // Create session so they can see the pending page
        const tempPassword = randomBytes(32).toString('base64url');
        await supabaseAdmin.auth.admin.updateUserById(user.id, { password: tempPassword });
        const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
          email: user.email!,
          password: tempPassword,
        });
        if (signInErr || !signIn.session) {
          return NextResponse.json({ error: 'Session creation failed' }, { status: 500 });
        }

        const response = NextResponse.json({
          user: { id: user.id, email: user.email },
          brands: [{
            sellerId:   brandData.id as string,
            sellerName: brandData.name as string,
            sellerSlug: brandData.slug as string,
            role:      memberships[0].role as string,
            status:    'pending',
          }],
          pending: true,
        });
        setBrandAuthCookies(response, signIn.session.access_token, signIn.session.refresh_token);
        return response;
      }

      return NextResponse.json(
        { error: 'Your brand account is not active. Please contact support.' },
        { status: 403 },
      );
    }

    // Active brand — create session
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
