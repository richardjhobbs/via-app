import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/via/search?q=<query>&limit=<n>: VIA network search contract.
 *
 * Every VIA member platform exposes this same shape so the network root
 * (www.getvia.xyz/mcp + app.getvia.xyz/mcp) can fan out across all members
 * and return pointers. Returns SELLERS as directory entries, not product
 * detail: the catalogue and the buy stay at origin. Each result carries the
 * per-seller mcp_url an agent connects to next.
 *
 * The query matches against BOTH the seller directory text (name / headline /
 * description) AND the seller's published product text (title / description),
 * so a query for an author, title, or category that only appears in the
 * catalogue still surfaces the seller that stocks it. A `matched_on` hint says
 * which surface hit. Product-text matches still return a seller pointer, never
 * the product row: the agent connects to the seller's MCP to list and buy.
 */

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

interface SearchResult {
  name: string;
  kind: string;
  detail: string | null;
  mcp_url: string;
  web_url: string | null;
  matched_on: 'seller' | 'product';
}

interface SellerRow {
  id: string;
  slug: string;
  name: string;
  kind: string | null;
  headline: string | null;
  description: string | null;
  website_url: string | null;
}

function toResult(row: SellerRow, matchedOn: 'seller' | 'product'): SearchResult {
  return {
    name: row.name,
    kind: row.kind || 'seller',
    detail: row.headline || row.description || null,
    mcp_url: `${APP_BASE}/sellers/${encodeURIComponent(row.slug)}/mcp`,
    web_url: row.website_url || `${APP_BASE}/sellers/${encodeURIComponent(row.slug)}`,
    matched_on: matchedOn,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 50);

  const cols = 'id, slug, name, kind, headline, description, website_url';

  // No query: just list active sellers.
  if (!q) {
    const { data, error } = await db
      .from('app_sellers')
      .select(cols)
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(limit);
    if (error) {
      console.error('[api/via/search] seller list failed:', error);
      return NextResponse.json({ platform: 'via', results: [], error: 'search_unavailable' }, { status: 200 });
    }
    const results = (data ?? []).map((r) => toResult(r as SellerRow, 'seller'));
    return NextResponse.json(
      { platform: 'via', results },
      { headers: { 'cache-control': 'public, max-age=30, s-maxage=30' } },
    );
  }

  const safe = q.replace(/[%,()]/g, ' ').trim();
  const pattern = `%${safe}%`;

  // Run the seller-directory match and the product-text match in parallel.
  // The product match resolves to its parent seller (still a directory pointer),
  // so an author / title / category that only lives in the catalogue is found.
  const [sellerHit, productHit] = await Promise.all([
    db
      .from('app_sellers')
      .select(cols)
      .eq('active', true)
      .or(`name.ilike.${pattern},description.ilike.${pattern},headline.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(limit),
    db
      .from('app_seller_products')
      .select('seller_id')
      .eq('active', true)
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .limit(200),
  ]);

  if (sellerHit.error) console.error('[api/via/search] seller match failed:', sellerHit.error);
  if (productHit.error) console.error('[api/via/search] product match failed:', productHit.error);

  const sellerRows = (sellerHit.data ?? []) as SellerRow[];
  const matchedSlugs = new Set(sellerRows.map((r) => r.slug));
  const results: SearchResult[] = sellerRows.map((r) => toResult(r, 'seller'));

  // Resolve product matches to their active parent sellers, skipping any already
  // surfaced by the directory match.
  const productSellerIds = Array.from(
    new Set(((productHit.data ?? []) as { seller_id: string }[]).map((r) => r.seller_id)),
  );
  if (productSellerIds.length > 0) {
    const { data: prodSellers, error: prodSellerErr } = await db
      .from('app_sellers')
      .select(cols)
      .eq('active', true)
      .in('id', productSellerIds);
    if (prodSellerErr) {
      console.error('[api/via/search] product-seller resolve failed:', prodSellerErr);
    } else {
      for (const row of (prodSellers ?? []) as SellerRow[]) {
        if (matchedSlugs.has(row.slug)) continue;
        matchedSlugs.add(row.slug);
        results.push(toResult(row, 'product'));
      }
    }
  }

  return NextResponse.json(
    { platform: 'via', results: results.slice(0, limit) },
    { headers: { 'cache-control': 'public, max-age=30, s-maxage=30' } },
  );
}
