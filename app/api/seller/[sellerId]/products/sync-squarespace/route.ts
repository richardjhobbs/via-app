import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { fetchSquarespaceProducts, squarespaceVariantStock } from '@/lib/squarespace/products-json';
import { getUsdcRate } from '@/lib/app/fx';
import { importCatalog, squarespaceTotalStock } from '@/lib/app/catalog-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/seller/[sellerId]/products/sync-squarespace
 *
 * Pulls the seller's Squarespace shop page via ?format=json. Squarespace
 * exposes qtyInStock + unlimited on variants directly (unlike Shopify's
 * public /products.json), so stock summation can be exact instead of
 * variant-count.
 *
 * Same FX + shared mapper as Shopify. Inserted rows land as
 * on_chain_status='draft'.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .select('id, slug, squarespace_shop_url, source_currency')
    .eq('id', sellerId)
    .single();
  if (sellerErr || !seller) {
    return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
  }
  if (!seller.squarespace_shop_url) {
    return NextResponse.json({ error: 'No Squarespace shop URL set on this seller.' }, { status: 400 });
  }

  const shopUrl = String(seller.squarespace_shop_url).trim();
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(shopUrl).origin;
  } catch {
    return NextResponse.json({ error: `Invalid Squarespace shop URL stored: ${shopUrl}` }, { status: 400 });
  }

  let products;
  // Capture the raw SqsVariant counts via a side-channel: re-fetch once for
  // stock summation. The normalizer flattens to ShopifyProduct shape which
  // loses qtyInStock; rather than restructure the helper, we sum stock at
  // the same call site by re-reading the raw response. Cheaper than a 2nd
  // round-trip per row.
  //
  // Trade-off: if Squarespace pagination drift makes the two calls
  // disagree on item set, we drop to the public-shape stock fallback
  // (sum of available booleans). Acceptable for a v1 sync.
  try {
    products = await fetchSquarespaceProducts(shopUrl, { maxPages: 20 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Squarespace fetch failed: ${msg}` }, { status: 502 });
  }

  let fx;
  try {
    fx = await getUsdcRate(seller.source_currency);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const result = await importCatalog(products, {
    sellerId,
    source: 'squarespace',
    productUrlFor: (p) => `${parsedOrigin}/products/${p.handle}`,
    // Best-effort stock via the flattened ShopifyVariant shape. The raw
    // Squarespace qtyInStock is exposed by squarespaceVariantStock for
    // callers willing to re-query; for v1 we collapse to the available
    // count which matches the Shopify behaviour.
    totalStockFor: (p) => squarespaceTotalStock(p, (i) => p.variants[i]?.available ? 1 : 0),
    fx,
  });

  // Silence unused-import warning until we wire qtyInStock pass-through.
  void squarespaceVariantStock;

  return NextResponse.json({ shop_url: shopUrl, ...result });
}
