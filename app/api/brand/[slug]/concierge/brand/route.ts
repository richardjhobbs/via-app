/**
 * GET /api/brand/[slug]/concierge/brand
 *
 * This brand's own RRG admin record (owner contact) for owner-escalation.
 * Backs the Hermes concierge MCP `rrg_brand_lookup` tool, replacing the
 * superadmin /api/rrg/admin/brands call so the concierge never needs the
 * superadmin secret. Read-only, concierge-scoped to {slug}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/rrg/auth';
import { getBrandBySlug } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();

  const brand = await getBrandBySlug(slug);
  if (!brand) {
    return NextResponse.json({ error: `Brand "${slug}" not found` }, { status: 404 });
  }

  return NextResponse.json({
    brand: {
      name: brand.name,
      slug: brand.slug,
      contact_email: brand.contact_email,
      website_url: brand.website_url,
      status: brand.status,
      shopify_domain: brand.shopify_domain,
    },
  });
}
