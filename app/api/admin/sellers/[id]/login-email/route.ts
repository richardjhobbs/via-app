import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { supabaseAdmin } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/sellers/[id]/login-email
 *
 * Superadmin action: change the seller owner's auth.users.email so they
 * can sign in with the new address. Distinct from the contact email on
 * app_sellers, which is just a display column. Sets email_confirmed_at
 * automatically (no verification mail sent) so the new login works
 * immediately.
 *
 * Body: { email: string }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;
  const body   = (await req.json()) as { email?: unknown };
  const email  = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'email must be a valid address' }, { status: 400 });
  }

  // Resolve the seller's auth user id so we can update the right account.
  const { data: seller, error: lookupErr } = await db
    .from('app_sellers')
    .select('id, owner_user_id')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr || !seller) {
    return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
  }
  const ownerUserId = seller.owner_user_id as string;

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(ownerUserId, {
    email,
    email_confirm: true,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, login_email: data.user?.email ?? email });
}
