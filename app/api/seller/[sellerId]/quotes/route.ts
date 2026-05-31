/**
 * GET /api/seller/[sellerId]/quotes
 *
 * Quote inbox for the seller owner. Lists negotiation threads opened by
 * buying agents via the per-seller MCP request_quote tool. Optional
 * ?status= filter; newest first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

const STATUSES = new Set([
  'pending_seller_approval',
  'approved',
  'revised_by_seller',
  'countered_by_buyer',
  'rejected',
  'expired',
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);

  let query = db
    .from('app_seller_quotes')
    .select('id, quote_ref, product_id, buyer_agent_id, contact, status, proposed_total_usdc, approved_total_usdc, breakdown, selections, spec, thread, valid_until, created_at, updated_at')
    .eq('seller_id', sellerId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (status && STATUSES.has(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))] as string[];
  let titleById = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: prods } = await db
      .from('app_seller_products')
      .select('id, title')
      .in('id', productIds);
    titleById = new Map((prods ?? []).map((p) => [p.id as string, p.title as string]));
  }

  const quotes = rows.map((r) => ({
    ...r,
    product_title: r.product_id ? (titleById.get(r.product_id as string) ?? null) : null,
  }));

  return NextResponse.json({ quotes });
}
