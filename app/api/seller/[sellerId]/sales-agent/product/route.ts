/**
 * GET /api/seller/[slug]/concierge/product?token_id=NNN
 *
 * Full detail + per-size stock for one product. Parity with the current
 * in-app concierge's getProductDetail. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/app/auth';
import {
  getSellerBySlug,
  getDropByTokenId,
  getVariantsBySubmissionId,
} from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId: slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();

  const brand = await getSellerBySlug(slug);
  if (!brand || brand.status !== 'active') {
    return NextResponse.json({ error: `Brand "${slug}" not found` }, { status: 404 });
  }

  const url = new URL(req.url);
  const tokenId = parseInt(url.searchParams.get('token_id') ?? '', 10);
  if (isNaN(tokenId)) {
    return NextResponse.json({ error: 'token_id is required' }, { status: 400 });
  }

  const drop = await getDropByTokenId(tokenId);
  if (!drop || drop.brand_id !== brand.id) {
    return NextResponse.json({ error: `Product #${tokenId} not found for ${brand.name}` }, { status: 404 });
  }

  const variants = await getVariantsBySubmissionId(drop.id);
  const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    token_id: drop.token_id,
    title: drop.title,
    price_usdc: parseFloat(drop.price_usdc ?? '0').toFixed(2),
    description: drop.description ?? null,
    enhanced_description: drop.enhanced_description ?? null,
    product_attributes: attrs,
    sizing_category: drop.sizing_category ?? null,
    variants: variants.map(v => ({
      size: v.size ?? 'OS',
      color: v.color ?? null,
      in_stock: v.cached_stock > 0,
      stock: v.cached_stock,
    })),
  });
}
