import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sellers/[slug]/concierge/products
 *
 * Active, on-chain-registered products the seller is currently selling.
 * The Hermes Sales Agent uses this to answer "what do you sell" and to
 * fold prices into negotiations.
 *
 * Query params:
 *   include_drafts  optional bool (default false)
 *   limit           default 200, max 1000
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url            = new URL(req.url);
  const includeDrafts  = url.searchParams.get('include_drafts') === 'true';
  const limit          = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 1), 1000);

  const { data: seller } = await db
    .from('app_sellers')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller) {
    return NextResponse.json({ error: 'seller not found' }, { status: 404 });
  }

  let query = db
    .from('app_seller_products')
    .select('id, external_id, kind, title, description, price_minor, currency, stock, url, metadata, token_id, max_supply, on_chain_status, active, created_at')
    .eq('seller_id', seller.id as string)
    .eq('active', true);
  if (!includeDrafts) {
    query = query.eq('on_chain_status', 'registered');
  }
  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data ?? [] });
}
