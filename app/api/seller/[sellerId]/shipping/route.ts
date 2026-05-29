import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import {
  getShippingConfig,
  normaliseShipping,
  isShippingReady,
  type ShippingConfig,
} from '@/lib/app/shipping';

export const dynamic = 'force-dynamic';

/**
 * GET /api/seller/[sellerId]/shipping
 *   Owner-only read of the stored shipping config. Returns
 *   { shipping: ShippingConfig | null, ready: boolean }.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_sellers')
    .select('shipping')
    .eq('id', sellerId)
    .single();
  if (error || !data) return NextResponse.json({ error: 'Seller not found' }, { status: 404 });

  const config = getShippingConfig(data.shipping);
  return NextResponse.json({ shipping: config, ready: isShippingReady(config) });
}

/**
 * PUT /api/seller/[sellerId]/shipping
 *   Owner-only write. Validates + normalises via normaliseShipping, then
 *   stores under the top-level `shipping` jsonb column. Always returns the
 *   normalised config so the client can mirror it back into local state.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  let body: Partial<ShippingConfig>;
  try {
    body = (await req.json()) as Partial<ShippingConfig>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const config = normaliseShipping(body);

  const { data, error } = await db
    .from('app_sellers')
    .update({ shipping: config, updated_at: new Date().toISOString() })
    .eq('id', sellerId)
    .select('shipping')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });

  const stored = getShippingConfig(data.shipping);
  return NextResponse.json({ shipping: stored, ready: isShippingReady(stored) });
}
