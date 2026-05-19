/**
 * GET /api/brand/[slug]/concierge/sizing?category=tops
 *
 * This brand's sizing chart, optionally for one category. Parity with the
 * current in-app concierge's getSizingSummary. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/rrg/auth';
import {
  getBrandBySlug,
  getSizingByBrand,
  getSizingByCategory,
} from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId: slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();

  const brand = await getBrandBySlug(slug);
  if (!brand || brand.status !== 'active') {
    return NextResponse.json({ error: `Brand "${slug}" not found` }, { status: 404 });
  }

  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? undefined;

  const sizing = category
    ? await getSizingByCategory(brand.id, category).then(s => (s ? [s] : []))
    : await getSizingByBrand(brand.id);

  return NextResponse.json({
    brand: brand.name,
    sizing: sizing.map(s => ({
      category: s.category,
      unit: s.unit,
      fit_notes: s.fit_notes,
      size_chart: s.size_chart,
      source_url: s.source_url,
    })),
  });
}
