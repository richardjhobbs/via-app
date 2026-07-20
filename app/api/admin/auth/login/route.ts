import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { issueAdminToken } from '@/lib/app/auth';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

// Comma-separated allowlist of emails whose Supabase account grants superadmin.
// ADMIN_SECRET remains the token-signing key and the x-admin-secret API bearer;
// it is no longer typed into the browser (a lone secret field trained password
// managers to save it as "the" app.getvia.xyz password, clobbering the real one).
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// POST /api/admin/auth/login : superadmin login with the SAME email + password
// as the buyer/seller doors (one Supabase account, one credential everywhere).
export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'ADMIN_SECRET not configured' }, { status: 500 });
  }

  if (isRateLimited(`admin-login|${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.redirect(new URL('/admin/login?error=too-many', req.url), 303);
  }

  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/admin');
  const safeNext = next.startsWith('/admin') ? next : '/admin';

  const fail = NextResponse.redirect(new URL('/admin/login?error=bad-credentials', req.url), 303);

  if (!email || !password) return fail;

  // One generic failure for bad credentials AND non-admin accounts, so the
  // response never confirms a valid email + password pair.
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) return fail;
  if (!adminEmails().includes(email)) return fail;

  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set('admin_token', issueAdminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
