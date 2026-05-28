import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/seller/[sellerId]/sales — owner-facing sales + USDC payout
 * history for the dashboard.
 *
 * Stage 1 returns an empty payload (no completed purchases yet on
 * mainnet). Once buy_product → operatorMint → distribution lands,
 * this surface joins app_distributions to app_purchases to
 * app_seller_products and returns the full ledger.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const [{ count: totalPurchases }, { count: totalDistributions }] = await Promise.all([
    db.from('app_purchases').select('id', { count: 'exact', head: true }).eq('seller_id', sellerId),
    db.from('app_distributions').select('id', { count: 'exact', head: true }).eq('seller_id', sellerId),
  ]);

  return NextResponse.json({
    stats: {
      total_purchases: totalPurchases ?? 0,
      total_distributions: totalDistributions ?? 0,
    },
    distributions: [],
  });
}
