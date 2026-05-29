import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sellers/[slug]/concierge/product
 *
 * Single product lookup, by token_id (preferred) or external_id. The
 * Sales Agent uses this when a buyer (or buying agent) references one
 * specific listing.
 *
 * Query params:
 *   token_id     bigint, the ERC-1155 token id
 *   external_id  the seller's source-system id (Shopify, Squarespace, CSV row)
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url        = new URL(req.url);
  const tokenIdRaw = url.searchParams.get('token_id');
  const externalId = url.searchParams.get('external_id');
  if (!tokenIdRaw && !externalId) {
    return NextResponse.json({ error: 'token_id or external_id required' }, { status: 400 });
  }

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
    .select('id, external_id, kind, title, description, price_minor, currency, stock, url, metadata, token_id, max_supply, on_chain_status, on_chain_tx_hash, active, created_at, updated_at')
    .eq('seller_id', seller.id as string)
    .limit(1);
  if (tokenIdRaw) {
    const n = Number(tokenIdRaw);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: 'token_id must be a number' }, { status: 400 });
    }
    query = query.eq('token_id', n);
  } else if (externalId) {
    query = query.eq('external_id', externalId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 });
  }
  return NextResponse.json({ product: data[0] });
}
