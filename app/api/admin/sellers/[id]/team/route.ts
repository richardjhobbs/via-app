import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { db } from '@/lib/app/db';
import { listTeam, inviteToSeller, type AssignableRole } from '@/lib/app/seller-team';

export const dynamic = 'force-dynamic';

/**
 * Superadmin team management for any store.
 * GET  : list members + pending invites.
 * POST : add a teammate by email (links an existing account, or emails an
 *        invite link). Body { email, role: 'admin' | 'viewer' }.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();
  const { id } = await ctx.params;
  const team = await listTeam(id);
  return NextResponse.json(team);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();
  const { id } = await ctx.params;

  let body: { email?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const email = typeof body.email === 'string' ? body.email : '';
  const role  = body.role === 'admin' || body.role === 'viewer' ? (body.role as AssignableRole) : null;
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });
  if (!role)  return NextResponse.json({ error: 'Role must be admin or viewer' }, { status: 400 });

  const { data: seller } = await db
    .from('app_sellers')
    .select('name, slug')
    .eq('id', id)
    .maybeSingle();
  if (!seller) return NextResponse.json({ error: 'Seller not found' }, { status: 404 });

  const result = await inviteToSeller({
    sellerId:     id,
    sellerName:   seller.name as string,
    sellerSlug:   seller.slug as string,
    email,
    role,
    invitedBy:    null,        // superadmin has no auth.users identity
    inviterEmail: null,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    linked: result.linked,
    message: result.linked ? 'Added to the team.' : 'Invitation sent.',
  });
}
