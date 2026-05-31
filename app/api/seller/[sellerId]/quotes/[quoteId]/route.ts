/**
 * GET /api/seller/[sellerId]/quotes/[quoteId]
 *
 * Single quote with its full negotiation thread and the product title.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; quoteId: string }> },
) {
  const { sellerId, quoteId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data: quote, error } = await db
    .from('app_seller_quotes')
    .select('id, quote_ref, product_id, buyer_agent_id, buyer_wallet, contact, status, proposed_total_usdc, approved_total_usdc, breakdown, selections, spec, thread, valid_until, created_at, updated_at')
    .eq('id', quoteId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

  let productTitle: string | null = null;
  if (quote.product_id) {
    const { data: prod } = await db
      .from('app_seller_products')
      .select('title')
      .eq('id', quote.product_id)
      .maybeSingle();
    productTitle = (prod?.title as string) ?? null;
  }

  return NextResponse.json({ quote: { ...quote, product_title: productTitle } });
}
