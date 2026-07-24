import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { sendPasswordResetEmail } from '@/lib/app/email';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';

export const dynamic = 'force-dynamic';

// POST /api/buyer/auth/forgot-password : send password reset email
export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(`buyer-forgot|${clientIp(req)}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please wait a minute and try again.' }, { status: 429 });
    }

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.getvia.xyz';

    // Generate the recovery link server-side (no email sent by Supabase) and
    // deliver via Resend, off Supabase Auth's built-in sender and its rate cap.
    // generateLink errors for unknown addresses; swallow it so the response
    // never reveals whether the email is registered.
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${siteUrl}/buyer/login?reset=true` },
    });
    const actionLink = link?.properties?.action_link;
    if (error || !actionLink) {
      console.error('[buyer/forgot-password] generateLink', error);
    } else {
      try {
        await sendPasswordResetEmail({ to: email, url: actionLink });
      } catch (sendErr) {
        console.error('[buyer/forgot-password] send', sendErr);
      }
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
