import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/seller/[sellerId]/sales — owner-facing sales + USDC payout
 * history for the dashboard.
 *
 * Returns:
 *   stats:      counters by purchase status + USDC totals (gross, paid
 *               to seller, retained by platform)
 *   purchases:  rows joined to app_seller_products (title, kind,
 *               token_id) and the matching app_distributions row
 *               (seller_usdc, platform_usdc, payout tx hash)
 *
 * Until the x402 settlement endpoint at /api/x402/purchase is wired,
 * this surface will mostly read zero — but the contract is stable so
 * the UI is correct on day one of real purchases.
 *
 * Owner-gated via requireBrandAuth.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const url     = new URL(req.url);
  const status  = url.searchParams.get('status');   // optional filter
  const limit   = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 500);

  // Stats: counts by status + aggregate USDC sums.
  const { data: byStatus } = await db
    .from('app_purchases')
    .select('status, total_usdc')
    .eq('seller_id', sellerId);

  const stats = {
    total_purchases: 0,
    by_status: { pending: 0, paid: 0, minted: 0, paid_out: 0, failed: 0 } as Record<string, number>,
    gross_usdc: 0,
    seller_usdc_paid_out: 0,
    platform_usdc_retained: 0,
  };
  for (const row of byStatus ?? []) {
    stats.total_purchases++;
    const s = String(row.status);
    if (s in stats.by_status) stats.by_status[s] += 1;
    stats.gross_usdc += Number(row.total_usdc ?? 0);
  }

  // Distribution sums (only paid-out lines contribute to "paid_out" totals;
  // pending distributions are surfaced in the row table but not the topline).
  const { data: distros } = await db
    .from('app_distributions')
    .select('seller_usdc, platform_usdc, status')
    .eq('seller_id', sellerId)
    .eq('status', 'paid');
  for (const d of distros ?? []) {
    stats.seller_usdc_paid_out  += Number(d.seller_usdc  ?? 0);
    stats.platform_usdc_retained += Number(d.platform_usdc ?? 0);
  }

  // Row query (join product + matching distribution).
  let q = db
    .from('app_purchases')
    .select(`
      id,
      order_ref,
      product_id,
      buyer_wallet,
      buyer_agent_id,
      qty,
      total_usdc,
      payment_method,
      mint_tx_hash,
      payout_tx_hash,
      status,
      notes,
      created_at,
      updated_at,
      product:app_seller_products!inner ( title, kind, token_id ),
      distribution:app_distributions ( id, seller_usdc, platform_usdc, split_type, seller_tx_hash, status, created_at )
    `)
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && ['pending','paid','minted','paid_out','failed'].includes(status)) {
    q = q.eq('status', status);
  }

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stats, purchases: rows ?? [] });
}
