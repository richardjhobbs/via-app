import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sellers/[slug]/concierge/seller
 *
 * Seller context the Hermes-side Sales Agent loads at session start.
 * Mirrors RRG /api/brand/[brandId]/concierge/brand but slug-keyed and with
 * the VIA field set. Authorised by the per-seller HMAC key (or full admin).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, headline, description, website_url, contact_email, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, shopify_domain, squarespace_shop_url, source_currency, catalog_source, shipping, purchase_policy, hermes_concierge_status, hermes_concierge_url, active, created_at')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !seller) {
    return NextResponse.json({ error: 'seller not found' }, { status: 404 });
  }

  return NextResponse.json({
    seller: {
      id:                 seller.id,
      slug:               seller.slug,
      name:               seller.name,
      kind:               seller.kind,
      headline:           seller.headline,
      description:        seller.description,
      website_url:        seller.website_url,
      contact_email:      seller.contact_email,
      payout_wallet:      seller.wallet_address,
      agent_wallet:       seller.agent_wallet_address,
      erc8004_seller_id:  seller.erc8004_seller_id,
      erc8004_agent_id:   seller.erc8004_agent_id,
      shopify_domain:     seller.shopify_domain,
      squarespace_shop_url: seller.squarespace_shop_url,
      source_currency:    seller.source_currency,
      catalog_source:     seller.catalog_source,
      shipping:           seller.shipping,
      purchase_policy:    seller.purchase_policy,
      hermes_concierge_status: seller.hermes_concierge_status,
      hermes_concierge_url:    seller.hermes_concierge_url,
      active:             seller.active,
      created_at:         seller.created_at,
      storefront_url:     `https://getvia.xyz/sellers/${seller.slug}`,
      mcp_url:            `https://app.getvia.xyz/sellers/${seller.slug}/mcp`,
    },
  });
}
