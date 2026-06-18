import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { mintBuyerIdentity } from '@/lib/app/buyer-identity';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/buyers/[id]/mint-identity
 *
 * Retry / repair the ERC-8004 identity mint for a buying agent whose
 * erc8004_agent_id is null. Gives the buyer a dedicated identity-only wallet
 * (so it never inherits a seller identity sharing the owner's funding wallet),
 * then mints via the registrar. Idempotent. Returns the registrar error
 * verbatim on failure so it is diagnosable.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;
  const result = await mintBuyerIdentity(id, 'superadmin');
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'mint failed' }, { status: 502 });
  }
  return NextResponse.json(result);
}
