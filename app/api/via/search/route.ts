import { NextResponse } from 'next/server';
import { searchCatalog, getPublicSeller, type PublicProduct, type PublicSeller } from '@/lib/app/seller-catalog';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/via/search?q=<query>&limit=<n>: VIA network search contract.
 *
 * Every VIA member platform exposes this same shape so a network root
 * (www.getvia.xyz/mcp + app.getvia.xyz/mcp) can fan out across members.
 *
 * The query matches the seller directory AND the published product catalogue
 * (title / description), so an author, title, or category that only appears in
 * the catalogue still surfaces. Defined intent returns PRODUCT-level results,
 * each with a direct human `web_url` to the product page and an MCP reference
 * the agent uses to transact. Loose / zero-match queries return a structured
 * `need_more_info` block: never an "empty / nothing available" dead end.
 *
 * Response:
 *   {
 *     platform: 'via',
 *     results:  [ { name, kind, detail, mcp_url, web_url, matched_on } ],  // legacy flat pointers (back-compat)
 *     products: PublicProduct[],   // product-level hits with product_url + mcp_ref
 *     sellers:  PublicSeller[],    // seller-level hits with no product match
 *     need_more_info?: { ... }     // present when the query is too loose / unmatched
 *   }
 */

interface FlatResult {
  name: string;
  kind: string;
  detail: string | null;
  mcp_url: string;
  web_url: string | null;
  matched_on: 'seller' | 'product';
}

function priceLabel(p: PublicProduct): string {
  if (p.price_usdc === null) return 'price on request';
  const amount = `${p.price_usdc} ${p.currency}`;
  return p.price_is_from ? `from ${amount}` : amount;
}

function productToFlat(p: PublicProduct): FlatResult {
  return {
    name: p.title,
    kind: 'product',
    detail: `${p.seller_name} · ${priceLabel(p)}`,
    mcp_url: p.mcp_ref.seller_mcp_url,
    web_url: p.product_url,
    matched_on: 'product',
  };
}

function sellerToFlat(s: PublicSeller): FlatResult {
  return {
    name: s.name,
    kind: s.kind,
    detail: s.headline || s.description || null,
    mcp_url: s.mcp_url,
    web_url: s.page_url,
    matched_on: 'seller',
  };
}

const DIMENSIONS = [
  'category or product type',
  'budget or price ceiling (USDC)',
  'brand, maker, or author',
  'intended use, occasion, or recipient',
  'key attributes (size, material, format, etc.)',
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 50);

  // No query: return a sample of active sellers (a browse entrypoint).
  if (!q) {
    const { data } = await db
      .from('app_sellers')
      .select('slug')
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(limit);
    const slugs = ((data ?? []) as { slug: string }[]).map((r) => r.slug);
    const sellers = (await Promise.all(slugs.map((s) => getPublicSeller(s)))).filter((s): s is PublicSeller => s !== null);
    return NextResponse.json(
      { platform: 'via', results: sellers.map(sellerToFlat), products: [], sellers },
      { headers: { 'cache-control': 'public, max-age=30, s-maxage=30' } },
    );
  }

  const { products, sellers } = await searchCatalog(q, limit);
  const results: FlatResult[] = [...products.map(productToFlat), ...sellers.map(sellerToFlat)];

  if (results.length === 0) {
    return NextResponse.json(
      {
        platform: 'via',
        results: [],
        products: [],
        sellers: [],
        need_more_info: {
          query: q,
          reason: 'no_match_on_indexed_text',
          guidance:
            'No catalogue or directory text matched this query on VIA. This is NOT proof the item is unavailable. Do not tell the user "nothing is available". Ask one clarifying question to sharpen intent, or retry with a broader term, a synonym, the category, or the brand/author name.',
          suggested_dimensions: DIMENSIONS,
        },
      },
      { headers: { 'cache-control': 'public, max-age=15, s-maxage=15' } },
    );
  }

  return NextResponse.json(
    { platform: 'via', results, products, sellers },
    { headers: { 'cache-control': 'public, max-age=30, s-maxage=30' } },
  );
}
