/**
 * GET / PUT /api/seller/[sellerId]/products/[productId]/offering
 *
 * Read or set a product's configurable option schema. PUT flips the product
 * to pricing_mode='configurable' and stores the generic OfferingSchema that
 * lib/app/quote-pricing.ts computes against. Setting pricing_mode='fixed'
 * clears the schema and restores normal fixed-price buy behaviour.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { parseOfferingSchema } from '@/lib/app/quote-pricing';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_seller_products')
    .select('id, title, pricing_mode, option_schema')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  return NextResponse.json({ product: data });
}

interface PutBody {
  pricing_mode:  'fixed' | 'configurable';
  option_schema?: unknown;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  let body: PutBody;
  try { body = (await req.json()) as PutBody; } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (body.pricing_mode !== 'fixed' && body.pricing_mode !== 'configurable') {
    return NextResponse.json({ error: "pricing_mode must be 'fixed' or 'configurable'" }, { status: 400 });
  }

  const update: Record<string, unknown> = { pricing_mode: body.pricing_mode, updated_at: new Date().toISOString() };

  if (body.pricing_mode === 'configurable') {
    const schema = parseOfferingSchema(body.option_schema);
    if (!schema) {
      return NextResponse.json({ error: 'option_schema is required for configurable pricing and must have base_price and a groups array' }, { status: 400 });
    }
    update.option_schema = body.option_schema;
  } else {
    update.option_schema = {};
  }

  const { data, error } = await db
    .from('app_seller_products')
    .update(update)
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .select('id, title, pricing_mode, option_schema')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  return NextResponse.json({ product: data });
}
