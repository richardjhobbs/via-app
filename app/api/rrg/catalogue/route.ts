import { NextRequest, NextResponse } from 'next/server';
import { db, getCurrentNetwork, getBrandBySlug } from '@/lib/rrg/db';
import { getSignedUrlsBatch } from '@/lib/rrg/storage';

/**
 * GET /api/rrg/catalogue?brand=<slug>
 *
 * Agent-readable JSON catalogue of all approved brand-owned listings.
 * Optional `?brand=<slug>` filter restricts to one brand's storefront.
 * Linked from /agent.json so agents can discover it.
 *
 * Cached at the edge for 60 s.
 */
export const dynamic = 'force-dynamic';

const SITE_URL  = process.env.NEXT_PUBLIC_SITE_URL || 'https://realrealgenuine.com';
const CONTRACT  = process.env.NEXT_PUBLIC_RRG_CONTRACT_ADDRESS || '';
const CHAIN_ID  = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '8453', 10);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const brandSlug = url.searchParams.get('brand');

  let brandId: string | null = null;
  let brandName: string | null = null;
  let brandWallet: string | null = null;
  if (brandSlug) {
    const brand = await getBrandBySlug(brandSlug);
    if (!brand) {
      return NextResponse.json({ error: `Brand not found: ${brandSlug}` }, { status: 404 });
    }
    brandId      = brand.id;
    brandName    = brand.name;
    brandWallet  = brand.wallet_address;
  }

  // Pull approved brand-owned listings on the current network.
  let q = db
    .from('rrg_submissions')
    .select('id, token_id, title, description, price_usdc, edition_size, jpeg_storage_path, brand_id, is_physical_product, shipping_type, ecommerce_url, approved_at')
    .eq('status', 'approved')
    .eq('network', getCurrentNetwork())
    .eq('hidden', false)
    .eq('is_brand_product', true)
    .order('approved_at', { ascending: false });
  if (brandId) q = q.eq('brand_id', brandId);

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mint counts for `minted` and stock_remaining.
  const tokenIds = (rows ?? []).map(r => r.token_id).filter((id): id is number => id != null);
  let mintedByToken = new Map<number, number>();
  if (tokenIds.length > 0) {
    const { data: purchases } = await db
      .from('rrg_purchases')
      .select('token_id')
      .in('token_id', tokenIds);
    for (const p of purchases ?? []) {
      mintedByToken.set(p.token_id, (mintedByToken.get(p.token_id) ?? 0) + 1);
    }
  }

  // Batch signed URLs (1 hour) — short enough to cache, long enough for agent reads.
  const imagePaths = (rows ?? []).map(r => r.jpeg_storage_path).filter((p): p is string => !!p);
  const signedMap = await getSignedUrlsBatch(imagePaths);

  // Resolve brand_id → slug for output (only if no slug filter — otherwise we know it).
  const distinctBrandIds = Array.from(new Set((rows ?? []).map(r => r.brand_id).filter((b): b is string => !!b)));
  const slugByBrandId = new Map<string, { slug: string; name: string }>();
  if (!brandSlug && distinctBrandIds.length > 0) {
    const { data: brands } = await db
      .from('rrg_brands')
      .select('id, slug, name')
      .in('id', distinctBrandIds);
    for (const b of brands ?? []) {
      slugByBrandId.set(b.id, { slug: b.slug, name: b.name });
    }
  }

  const products = (rows ?? []).map(r => {
    const minted = r.token_id != null ? (mintedByToken.get(r.token_id) ?? 0) : 0;
    const stock_remaining = Math.max(0, (r.edition_size ?? 0) - minted);
    const brandInfo = brandSlug
      ? { slug: brandSlug, name: brandName }
      : (r.brand_id ? slugByBrandId.get(r.brand_id) ?? null : null);
    return {
      token_id:          r.token_id,
      brand:             brandInfo?.slug ?? null,
      brand_name:        brandInfo?.name ?? null,
      title:             r.title,
      description:       r.description,
      price_usdc:        r.price_usdc,
      currency:          'USDC',
      edition_size:      r.edition_size,
      minted,
      stock_remaining,
      sold_out:          stock_remaining === 0,
      image_url:         r.jpeg_storage_path ? signedMap.get(r.jpeg_storage_path) ?? null : null,
      buy_url:           r.token_id != null ? `${SITE_URL}/rrg/listing/${r.token_id}` : null,
      agent_buy_endpoint:`${SITE_URL}/api/rrg/claim`,
      is_physical:       !!r.is_physical_product,
      shipping_type:     r.shipping_type,
      external_url:      r.ecommerce_url,
    };
  });

  const body = {
    catalogue_version: 1,
    chain_id:          CHAIN_ID,
    contract:          CONTRACT,
    network:           getCurrentNetwork(),
    site_url:          SITE_URL,
    brand:             brandSlug
      ? { slug: brandSlug, name: brandName, wallet: brandWallet, storefront: `${SITE_URL}/brand/${brandSlug}` }
      : null,
    product_count:     products.length,
    products,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
