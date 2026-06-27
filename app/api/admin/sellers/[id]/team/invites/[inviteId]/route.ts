import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { revokeInvite } from '@/lib/app/seller-team';

export const dynamic = 'force-dynamic';

/** Superadmin: revoke a pending invite. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; inviteId: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();
  const { id, inviteId } = await ctx.params;

  const ok = await revokeInvite(id, inviteId);
  if (!ok) return NextResponse.json({ error: 'Could not revoke invite' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
