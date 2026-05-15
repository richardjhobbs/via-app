/**
 * Brand admin membership management (super-admin only).
 *
 *   GET    /api/rrg/admin/brands/[brandId]/members  -> list admins/viewers
 *   DELETE /api/rrg/admin/brands/[brandId]/members   body { user_id }
 *   PATCH  /api/rrg/admin/brands/[brandId]/members    body { user_id, role }
 *
 * "members" are rows in rrg_brand_members. An 'admin' row is exactly what
 * gates the concierge admin chat (see lib/rrg/brand-auth.ts isBrandAdmin),
 * so this is the editable surface for who can reach a brand's concierge.
 * Adding a member is the invite/activation path (POST .../brands/invite).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import { supabaseAdmin } from '@/lib/rrg/brand-auth';

export const dynamic = 'force-dynamic';

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();
  const { brandId } = await params;

  const { data, error } = await db
    .from('rrg_brand_members')
    .select('id, user_id, role, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as MemberRow[];
  const members = await Promise.all(
    rows.map(async (m) => {
      let email: string | null = null;
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
        email = u.user?.email ?? null;
      } catch {
        email = null;
      }
      return { id: m.id, userId: m.user_id, email, role: m.role, createdAt: m.created_at };
    }),
  );

  return NextResponse.json({ members });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();
  const { brandId } = await params;

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.user_id) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  // Remove the membership only. The auth user is left intact (it may be a
  // member of other brands); dropping the row revokes concierge access.
  const { error } = await db
    .from('rrg_brand_members')
    .delete()
    .eq('brand_id', brandId)
    .eq('user_id', body.user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();
  const { brandId } = await params;

  let body: { user_id?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.user_id || (body.role !== 'admin' && body.role !== 'viewer')) {
    return NextResponse.json({ error: "user_id and role ('admin'|'viewer') required" }, { status: 400 });
  }

  const { error } = await db
    .from('rrg_brand_members')
    .update({ role: body.role })
    .eq('brand_id', brandId)
    .eq('user_id', body.user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, role: body.role });
}
