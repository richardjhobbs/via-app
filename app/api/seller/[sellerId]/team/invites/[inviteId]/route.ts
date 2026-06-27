import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { revokeInvite } from '@/lib/app/seller-team';

export const dynamic = 'force-dynamic';

/** DELETE /api/seller/[sellerId]/team/invites/[inviteId] : revoke a pending invite (admin+). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; inviteId: string }> },
) {
  const { sellerId, inviteId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  const ok = await revokeInvite(sellerId, inviteId);
  if (!ok) return NextResponse.json({ error: 'Could not revoke invite' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
