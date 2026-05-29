import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

// POST /api/buyer/auth/forgot-password — send password reset email
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.getvia.xyz';

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/buyer/login?reset=true`,
    });

    if (error) {
      console.error('[buyer/forgot-password]', error);
    }

    // Always return success to prevent email enumeration.
    return NextResponse.json({
      success: true,
      message: 'If that email is registered, you will receive a password reset link.',
    });
  } catch (err) {
    console.error('[/api/buyer/auth/forgot-password]', err);
    return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
  }
}
