import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { fetchShopifyProducts, type ShopifyProduct } from '@/lib/shopify/products-json';
import { getUsdcRate } from '@/lib/app/fx';
import { importCatalog, shopifyTotalStock } from '@/lib/app/catalog-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/seller/[sellerId]/products/sync-shopify
 *
 * Pulls the seller's Shopify catalogue from the public /products.json
 * endpoint (no Shopify auth required — works on any store with a public
 * catalog), converts native prices to USDC using the seller's
 * source_currency + frankfurter.app FX, and upserts via the shared
 * catalog-import mapper. Inserted rows land as on_chain_status='draft'.
 *
 * VIA is data-only: image fields on Shopify products are ignored. See
 * feedback_via_is_data_not_images.md.
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
    .select('id, slug, shopify_domain, source_currency')
    .eq('id', sellerId)
    .single();
  if (sellerErr || !seller) {
    return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
  }
  if (!seller.shopify_domain) {
    return NextResponse.json({ error: 'No Shopify domain set on this seller.' }, { status: 400 });
  }

  const domain = String(seller.shopify_domain).trim();
  if (!/^[a-zA-Z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: `Invalid Shopify domain stored: ${domain}` }, { status: 400 });
  }

  let products: ShopifyProduct[];
  try {
    products = await fetchShopifyProducts(domain, 250);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Shopify fetch failed: ${msg}` }, { status: 502 });
  }

  let fx;
  try {
    fx = await getUsdcRate(seller.source_currency);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const result = await importCatalog(products, {
    sellerId,
    source: 'shopify',
    productUrlFor: (p) => `https://${domain}/products/${p.handle}`,
    totalStockFor: shopifyTotalStock,
    fx,
  });

  return NextResponse.json({ domain, ...result });
}
