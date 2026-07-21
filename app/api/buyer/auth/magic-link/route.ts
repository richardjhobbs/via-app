import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/buyer/auth/magic-link : passwordless sign-in for returning users.
 *
 * Body: { email, next? }. If the email has a VIA account, a sign-in link is
 * emailed; clicking it lands back on the login page with session tokens in the
 * hash, which the page exchanges for cookies. Unknown emails are told so, with
 * the create-an-agent path, mirroring the RRG login.
 */
export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(`buyer-magic|${clientIp(req)}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please wait a minute and try again.' }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const next = String(body.next ?? '');
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const known = Boolean(list?.users?.some((u: { email?: string | null }) => u.email?.toLowerCase() === email));
    if (!known) {
      return NextResponse.json({ known: false });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.getvia.xyz';
    // Same-origin relative next only; it rides the redirect back to the login
    // page so the signed-in user lands where they were headed.
    const dest = /^\/(?!\/)/.test(next) ? `?next=${encodeURIComponent(next)}` : '';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${siteUrl}/buyer/login${dest}`, shouldCreateUser: false },
    });
    if (error) {
      console.error('[buyer/magic-link]', error);
      return NextResponse.json({ error: 'Could not send the sign-in link. Try again in a minute.' }, { status: 500 });
    }
    return NextResponse.json({ known: true, sent: true });
  } catch (err) {
    console.error('[/api/buyer/auth/magic-link]', err);
    return NextResponse.json({ error: 'Could not send the sign-in link' }, { status: 500 });
  }
}
