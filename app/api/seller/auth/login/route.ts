import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setBrandAuthCookies, getUserBrands } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

// POST /api/seller/auth/login — brand admin email/password login
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Verify they have at least one brand membership
    const brands = await getUserBrands(data.user.id);
    if (brands.length === 0) {
      return NextResponse.json({ error: 'No brand access' }, { status: 403 });
    }

    const response = NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
      brands,
    });

    setBrandAuthCookies(response, data.session.access_token, data.session.refresh_token);

    return response;
  } catch (err) {
    console.error('[/api/seller/auth/login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
