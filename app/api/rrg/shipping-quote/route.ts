/**
 * POST /api/rrg/shipping-quote
 *
 * Returns shipping rates for a product + size + address. Called from the
 * checkout flow before the buyer confirms payment so the total includes
 * shipping cost.
 *
 * Body:
 *   tokenId:  number   — RRG token ID of the product
 *   size:     string   — size selected (e.g. "M")
 *   address:  { line1, city, postalCode, country, ... }
 *
 * Response:
 *   { ok: true, options: [{ handle, title, priceUsd }], currency, source }
 *   { ok: false, error, code }
 *
 * When the brand has no Shopify token configured, returns source:'fallback_zero'
 * with empty options. The UI should surface this as "Shipping included" so the
 * existing checkout flow still works.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getShippingQuoteByToken, type ShippingAddress } from '@/lib/rrg/shopify-shipping';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: {
    tokenId?: number;
    size?:    string;
    address?: ShippingAddress;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON', code: 'invalid_request' }, { status: 400 });
  }

  const { tokenId, size, address } = body;

  if (typeof tokenId !== 'number') {
    return NextResponse.json({ ok: false, error: 'tokenId required', code: 'invalid_request' }, { status: 400 });
  }
  if (!address?.line1 || !address?.city || !address?.postalCode || !address?.country) {
    return NextResponse.json(
      { ok: false, error: 'address.line1, city, postalCode, country required', code: 'invalid_address' },
      { status: 400 },
    );
  }

  try {
    const result = await getShippingQuoteByToken({
      tokenId,
      size: size ?? '',
      address,
    });

    // Always return 200 — structured ok/error in body
    return NextResponse.json(result);
  } catch (e) {
    console.error('[shipping-quote] unexpected error:', e);
    return NextResponse.json(
      { ok: false, error: 'Unexpected error', code: 'api_error' },
      { status: 500 },
    );
  }
}
