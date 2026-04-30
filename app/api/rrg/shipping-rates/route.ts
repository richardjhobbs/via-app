/**
 * POST /api/rrg/shipping-rates
 *
 * Given a tokenId and a shipping address, returns the live Shopify-computed
 * delivery options the buyer can choose from. Empty options = brand does
 * not ship to that destination (we enforce this as a geo-restriction
 * on the checkout side — buyer cannot proceed).
 *
 * Body: {
 *   tokenId: number,
 *   quantity?: number,   // default 1
 *   address: {
 *     address1, address2?, city, province?, zip, countryCode, firstName?, lastName?, phone?
 *   }
 * }
 *
 * Response: { deliverable: boolean, options: RateOption[], cart_id }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, getCurrentNetwork } from '@/lib/rrg/db';
import { resolveShippingRates, type ShippingAddress } from '@/lib/shopify/delivery';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tokenId  = Number(body.tokenId);
    const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1)));
    const address  = body.address as ShippingAddress | undefined;

    if (!Number.isFinite(tokenId)) {
      return NextResponse.json({ error: 'tokenId required' }, { status: 400 });
    }
    if (!address || !address.address1 || !address.city || !address.zip || !address.countryCode) {
      return NextResponse.json({ error: 'address.{address1,city,zip,countryCode} required' }, { status: 400 });
    }

    // Resolve the drop → brand slug + variant GID
    const { data: drop, error: dropErr } = await db
      .from('rrg_submissions')
      .select('id, token_id, shopify_variant_gid, is_physical_product, brand_id, status, hidden, network')
      .eq('token_id', tokenId)
      .eq('network', getCurrentNetwork())
      .eq('status', 'approved')
      .eq('hidden', false)
      .maybeSingle();
    if (dropErr) return NextResponse.json({ error: dropErr.message }, { status: 500 });
    if (!drop)  return NextResponse.json({ error: `Drop not found for tokenId ${tokenId}` }, { status: 404 });
    if (!drop.is_physical_product) {
      // Digital-only drops have no shipping.
      return NextResponse.json({ deliverable: true, options: [], address, cart_id: null, note: 'Digital product — no shipping required.' });
    }
    if (!drop.shopify_variant_gid) {
      return NextResponse.json({ error: 'No Shopify variant GID for this drop — live shipping rates unavailable.' }, { status: 409 });
    }
    if (!drop.brand_id) {
      return NextResponse.json({ error: 'Drop has no brand_id' }, { status: 500 });
    }

    const { data: brand } = await db
      .from('rrg_brands')
      .select('slug, status')
      .eq('id', drop.brand_id)
      .maybeSingle();
    if (!brand || brand.status !== 'active') {
      return NextResponse.json({ error: 'Brand not available' }, { status: 404 });
    }

    const result = await resolveShippingRates(brand.slug, drop.shopify_variant_gid, quantity, address);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
