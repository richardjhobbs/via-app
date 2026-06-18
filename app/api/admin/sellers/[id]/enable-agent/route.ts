import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';
import { enableStoreAgent } from '@/lib/app/store-registration';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sellers/[id]/enable-agent
 *
 * Bring an already-listed but un-onboarded store (e.g. ingested with no
 * agent_wallet_address / no erc8004_agent_id) to full end-to-end state:
 * derive + persist the platform agent wallet, seed the x402 micro-fee float,
 * then mint (or link) its ERC-8004 identity. Idempotent. Operator action.
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

  const result = await enableStoreAgent(seller.slug as string, 'superadmin');
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? result.mint_error ?? 'enable failed', ...result }, { status: 502 });
  }
  return NextResponse.json(result);
}
