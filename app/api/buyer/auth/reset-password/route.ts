import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setBuyerAuthCookies } from '@/lib/app/buyer-auth';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

// POST /api/buyer/auth/reset-password — set new password with recovery tokens
export async function POST(req: NextRequest) {
  try {
    const { access_token, refresh_token, password } = await req.json();

    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: 'Invalid reset link' }, { status: 400 });
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (sessionError) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
    }

    const { data, error } = await supabase.auth.updateUser({ password });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const response = NextResponse.json({
      success: true,
      message: 'Password updated successfully',
    });

    if (data.user) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        setBuyerAuthCookies(
          response,
          sessionData.session.access_token,
          sessionData.session.refresh_token,
        );
      }
    }

    return response;
  } catch (err) {
    console.error('[/api/buyer/auth/reset-password]', err);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
