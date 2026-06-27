import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { changeMemberRole, removeMember, type AssignableRole } from '@/lib/app/seller-team';

export const dynamic = 'force-dynamic';

/** Superadmin: change a member's role. Body { role: 'admin' | 'viewer' }. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; userId: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();
  const { id, userId } = await ctx.params;

  let body: { role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const role = body.role === 'admin' || body.role === 'viewer' ? (body.role as AssignableRole) : null;
  if (!role) return NextResponse.json({ error: 'Role must be admin or viewer' }, { status: 400 });

  const result = await changeMemberRole(id, userId, role);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Superadmin: remove a member. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; userId: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();
  const { id, userId } = await ctx.params;

  const result = await removeMember(id, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
