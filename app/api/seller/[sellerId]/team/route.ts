import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { listTeam, inviteToSeller, type AssignableRole } from '@/lib/app/seller-team';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

/** GET /api/seller/[sellerId]/team : members + pending invites (admin+). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  const team = await listTeam(sellerId);
  return NextResponse.json(team);
}

/** POST /api/seller/[sellerId]/team : invite a teammate by email (admin+). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  let body: { email?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const email = typeof body.email === 'string' ? body.email : '';
  const role  = body.role === 'admin' || body.role === 'viewer' ? (body.role as AssignableRole) : null;
  if (!email)  return NextResponse.json({ error: 'Email required' }, { status: 400 });
  if (!role)   return NextResponse.json({ error: 'Role must be admin or viewer' }, { status: 400 });

  const { data: seller } = await db
    .from('app_sellers')
    .select('name, slug')
    .eq('id', sellerId)
    .maybeSingle();
  if (!seller) return NextResponse.json({ error: 'Seller not found' }, { status: 404 });

  const result = await inviteToSeller({
    sellerId,
    sellerName:   seller.name as string,
    sellerSlug:   seller.slug as string,
    email,
    role,
    invitedBy:    auth.user.id,
    inviterEmail: auth.user.email,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    linked: result.linked,
    message: result.linked
      ? 'Added to the team.'
      : 'Invitation sent.',
  });
}
