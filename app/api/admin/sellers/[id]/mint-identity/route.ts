import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { mintStoreIdentity } from '@/lib/app/store-registration';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sellers/[id]/mint-identity
 *
 * Retry the ERC-8004 identity mint for an approved store whose erc8004_agent_id
 * is null (e.g. the registrar mint failed at approval time). Idempotent.
 * Returns the registrar error verbatim on failure so it is diagnosable.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;
  const { data: seller, error } = await db
    .from('app_sellers')
    .select('slug')
    .eq('id', id)
    .maybeSingle();
  if (error || !seller) return NextResponse.json({ error: 'seller not found' }, { status: 404 });

  const result = await mintStoreIdentity(seller.slug as string, 'superadmin');
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? result.mint_error ?? 'mint failed' }, { status: 502 });
  }
  return NextResponse.json(result);
}
