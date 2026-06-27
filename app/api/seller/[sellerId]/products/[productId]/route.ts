import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { sanitiseVinylInput } from '@/lib/app/vinyl';

export const dynamic = 'force-dynamic';

interface UpdateBody {
  title?: string;
  description?: string | null;
  price_usdc?: number;
  stock?: number | null;
  max_supply?: number | null;
  url?: string | null;
  vinyl?: Record<string, unknown>; // partial metadata.vinyl block, merged in
}

/**
 * PUT /api/seller/[sellerId]/products/[productId]
 *   Update an editable field on a product. Once a product has been
 *   published on-chain (on_chain_status='registered'), price_minor and
 *   max_supply are immutable — those are baked into the ERC-1155
 *   registerDrop tx and cannot change without a new tokenId. Stock,
 *   title, description, and links remain editable.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  let body: UpdateBody;
  try { body = (await req.json()) as UpdateBody; } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { data: existing, error: readErr } = await db
    .from('app_seller_products')
    .select('id, seller_id, on_chain_status, metadata')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const isRegistered = existing.on_chain_status === 'registered';

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Vinyl block: validate + merge the partial into metadata.vinyl so a seller
  // can complete the grades an import could not parse. See lib/app/vinyl.ts.
  if (body.vinyl !== undefined) {
    const sanitised = sanitiseVinylInput(body.vinyl);
    if (!sanitised.ok) return NextResponse.json({ error: sanitised.error }, { status: 400 });
    const existingMeta  = (existing.metadata as Record<string, unknown> | null) ?? {};
    const existingVinyl = (existingMeta.vinyl as Record<string, unknown> | null) ?? {};
    update.metadata = { ...existingMeta, vinyl: { ...existingVinyl, ...sanitised.vinyl } };
  }

  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (t.length < 2 || t.length > 200) {
      return NextResponse.json({ error: 'title must be 2-200 characters' }, { status: 400 });
    }
    update.title = t;
  }
  if (body.description !== undefined) update.description = body.description;
  if (body.stock !== undefined)       update.stock       = body.stock;
  if (body.url !== undefined)         update.url         = body.url;

  if (body.price_usdc !== undefined) {
    if (isRegistered) {
      return NextResponse.json({ error: 'Price is immutable after on-chain registration' }, { status: 400 });
    }
    if (typeof body.price_usdc !== 'number' || !isFinite(body.price_usdc) || body.price_usdc < 0) {
      return NextResponse.json({ error: 'price_usdc must be a non-negative number' }, { status: 400 });
    }
    update.price_minor = Math.round(body.price_usdc * 1_000_000);
  }
  if (body.max_supply !== undefined) {
    if (isRegistered) {
      return NextResponse.json({ error: 'max_supply is immutable after on-chain registration' }, { status: 400 });
    }
    update.max_supply = body.max_supply;
  }

  const { data, error } = await db
    .from('app_seller_products')
    .update(update)
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .select('id, kind, title, description, price_minor, currency, stock, max_supply, url, active, on_chain_status, on_chain_tx_hash, token_id, metadata, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}

/**
 * DELETE /api/seller/[sellerId]/products/[productId]
 *   Soft delete (active=false). Hard delete would orphan the on-chain
 *   tokenId. Registered products can be deactivated, just not removed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_seller_products')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .select('id, active')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  return NextResponse.json({ product: data });
}
