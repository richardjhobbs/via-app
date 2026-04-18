/**
 * Invoked by the via-brand-onboarding admin surface when a brand is
 * approved. Responsibilities:
 *   1. Copy brand_data fields that have top-level columns to their
 *      columns (headline, website_url, social_links, description) as a
 *      safety net, in case anything wasn't mirrored during onboarding.
 *   2. Flip rrg_brands.status from 'pending' → 'active' so the brand's
 *      storefront goes live.
 *   3. Emit a best-effort note indicating the concierge agent should be
 *      registered. For now this is logged; full on-chain mint is still
 *      run manually via scripts/register-brand-concierge.mjs until we
 *      automate it in v2.
 *
 * Auth: shared secret in x-admin-secret header, matched against
 * RRG_INTERNAL_ADMIN_SECRET env var. This is separate from the main
 * admin_token cookie because the caller is another server, not a logged-in
 * admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  brandId?: string;
  slug?: string;
  name?: string;
  contactEmail?: string;
  shopifyDomain?: string | null;
  onboardingPath?: string | null;
}

interface BrandRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  onboarding_status: string;
  shopify_domain: string | null;
  headline: string | null;
  website_url: string | null;
  description: string | null;
  social_links: Record<string, unknown> | null;
  brand_data: Record<string, unknown> | null;
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.RRG_INTERNAL_ADMIN_SECRET;
  const provided = req.headers.get('x-admin-secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const { brandId, slug } = body;

  if (!brandId && !slug) {
    return NextResponse.json(
      { error: 'brandId or slug required' },
      { status: 400 },
    );
  }

  const { data: brand, error: lookupErr } = await db
    .from('rrg_brands')
    .select(
      'id, slug, name, status, onboarding_status, shopify_domain, headline, website_url, description, social_links, brand_data',
    )
    .eq(brandId ? 'id' : 'slug', brandId ?? slug!)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json(
      { error: `lookup failed: ${lookupErr.message}` },
      { status: 500 },
    );
  }
  if (!brand) {
    return NextResponse.json({ error: 'brand not found' }, { status: 404 });
  }

  const row = brand as BrandRow;
  const bd = (row.brand_data ?? {}) as Record<string, unknown>;

  // Safety net: if any top-level column is still empty but the source
  // of truth in brand_data has a value, copy it over. This catches
  // brands onboarded before the mirror logic was in place, or anything
  // that slipped through during extraction.
  const backfill: Record<string, unknown> = {
    status: 'active',
    onboarding_status: 'live',
    tc_accepted_at: new Date().toISOString(),
    tc_version: '1.0',
  };

  if (!row.headline) {
    const headline = str(bd.headline);
    if (headline) backfill.headline = headline;
  }
  if (!row.website_url) {
    const website = str(bd.websiteUrl);
    if (website) backfill.website_url = website;
  }
  if (!row.description) {
    const desc = str(bd.originStory);
    if (desc) backfill.description = desc;
  }
  if (
    (!row.social_links || Object.keys(row.social_links).length === 0) &&
    bd.socialHandles &&
    typeof bd.socialHandles === 'object'
  ) {
    backfill.social_links = bd.socialHandles;
  }

  const { error: updateErr } = await db
    .from('rrg_brands')
    .update(backfill)
    .eq('id', row.id);

  if (updateErr) {
    return NextResponse.json(
      { error: `status update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[onboarding-complete] ${row.slug} (${row.id}) marked live. ` +
      `Next manual step: node scripts/register-brand-concierge.mjs --slug ${row.slug}`,
  );

  return NextResponse.json({
    ok: true,
    brandId: row.id,
    slug: row.slug,
    backfilled: Object.keys(backfill).filter(
      (k) => !['status', 'onboarding_status', 'tc_accepted_at', 'tc_version'].includes(k),
    ),
    nextSteps: {
      mintConcierge: `scripts/register-brand-concierge.mjs --slug ${row.slug}`,
      mirrorCatalogue: row.shopify_domain
        ? `scripts/brand-mirror.mjs --slug ${row.slug} --commit-chain`
        : null,
    },
  });
}
