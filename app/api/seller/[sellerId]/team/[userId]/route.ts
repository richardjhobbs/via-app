import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { changeMemberRole, removeMember, type AssignableRole } from '@/lib/app/seller-team';

export const dynamic = 'force-dynamic';

/** PATCH /api/seller/[sellerId]/team/[userId] : change a member's role (admin+). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; userId: string }> },
) {
  const { sellerId, userId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  let body: { role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const role = body.role === 'admin' || body.role === 'viewer' ? (body.role as AssignableRole) : null;
  if (!role) return NextResponse.json({ error: 'Role must be admin or viewer' }, { status: 400 });

  const result = await changeMemberRole(sellerId, userId, role);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/seller/[sellerId]/team/[userId] : remove a member (admin+). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; userId: string }> },
) {
  const { sellerId, userId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  const result = await removeMember(sellerId, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
