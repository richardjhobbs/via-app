/**
 * GET /api/seller/[slug]/concierge/products
 *
 * Live agent-ready catalogue for this brand. Faithful parity with the data
 * the current in-app concierge uses (lib/app/brand-telegram-bot.ts
 * getAgentReadyProductContext): token id, title, price USDC,
 * enhanced_description, fabric / fit / colour, in-stock sizes. The only
 * product source of truth for the Hermes concierge. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/app/auth';
import {
  getSellerBySlug,
  getApprovedDrops,
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

  const drops = await getApprovedDrops(brand.id);
  const products = await Promise.all(drops.map(async (d) => {
    const variants = await getVariantsBySubmissionId(d.id);
    const attrs = (d.product_attributes ?? {}) as Record<string, unknown>;
    return {
      token_id: d.token_id,
      title: d.title,
      price_usdc: parseFloat(d.price_usdc ?? '0').toFixed(2),
      enhanced_description: d.enhanced_description ?? null,
      fabric: typeof attrs.fabric_guess === 'string' ? attrs.fabric_guess : null,
      fit: typeof attrs.fit === 'string' ? attrs.fit : null,
      primary_color: typeof attrs.primary_color === 'string' ? attrs.primary_color : null,
      sizes_in_stock: variants.filter(v => v.cached_stock > 0).map(v => v.size).filter(Boolean),
      sizes_out_of_stock: variants.filter(v => v.cached_stock <= 0).map(v => v.size).filter(Boolean),
    };
  }));

  return NextResponse.json({ brand: brand.name, products });
}
