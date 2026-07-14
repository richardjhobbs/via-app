import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sellers/[id]/products/[productId]
 *
 * Superadmin product-level moderation. Approved stores add products freely;
 * this is the post-hoc takedown.
 *
 *   body: { action: 'cancel' | 'restore' | 'delete', reason?: string }
 *     cancel  → admin_removed=true. Reversible kill-switch: the listing
 *               disappears from every buyer-facing read and cannot be bought,
 *               independent of the seller's own active flag. Order history kept.
 *     restore → admin_removed=false. Brings the listing back.
 *     delete  → hard-delete the row. Blocked (409) if any purchase references
 *               it (app_purchases.product_id is ON DELETE RESTRICT); cancel
 *               instead to preserve the ledger.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; productId: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id, productId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  const action = body.action;

  const { data: product, error: loadErr } = await db
    .from('app_seller_products')
    .select('id, title, admin_removed')
    .eq('id', productId)
    .eq('seller_id', id)
    .maybeSingle();
  if (loadErr || !product) {
    return NextResponse.json({ error: 'product not found for this seller' }, { status: 404 });
  }

  if (action === 'cancel') {
    const { error } = await db
      .from('app_seller_products')
      .update({
        admin_removed:        true,
        admin_removed_reason: (body.reason ?? '').trim().slice(0, 200) || 'removed by superadmin',
        admin_removed_at:     new Date().toISOString(),
        admin_removed_by:     'superadmin',
        updated_at:           new Date().toISOString(),
      })
      .eq('id', productId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, product_id: productId, admin_removed: true });
  }

  if (action === 'restore') {
    const { error } = await db
      .from('app_seller_products')
      .update({
        admin_removed:        false,
        admin_removed_reason: null,
        admin_removed_at:     null,
        admin_removed_by:     null,
        updated_at:           new Date().toISOString(),
      })
      .eq('id', productId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, product_id: productId, admin_removed: false });
  }

  if (action === 'delete') {
    const { count } = await db
      .from('app_purchases')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: `"${product.title}" has ${count} purchase(s) on record and cannot be deleted. Cancel the listing instead: it leaves the marketplace but keeps the order history.`,
      }, { status: 409 });
    }
    const { error } = await db
      .from('app_seller_products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, product_id: productId, deleted: true });
  }

  return NextResponse.json({ error: "action must be 'cancel', 'restore', or 'delete'" }, { status: 400 });
}

interface AdminProductEdit {
  title?:       string;
  description?: string | null;
  price_usdc?:  number;
  stock?:       number | null;
  url?:         string | null;
}

/**
 * PATCH /api/admin/sellers/[id]/products/[productId]
 *
 * Superadmin field edit — the same editable surface the seller has
 * (PUT /api/seller/[sellerId]/products/[productId]) but reachable from the
 * admin console. Price is immutable once the product is registered on-chain
 * (baked into the ERC-1155 registerDrop tx); title, description, stock and
 * link stay editable in every state.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; productId: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id, productId } = await ctx.params;

  let body: AdminProductEdit;
  try { body = (await req.json()) as AdminProductEdit; } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { data: existing, error: readErr } = await db
    .from('app_seller_products')
    .select('id, on_chain_status')
    .eq('id', productId)
    .eq('seller_id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'product not found for this seller' }, { status: 404 });

  const isRegistered = existing.on_chain_status === 'registered';
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

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

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 });
  }

  const { data, error } = await db
    .from('app_seller_products')
    .update(update)
    .eq('id', productId)
    .eq('seller_id', id)
    .select('id, title, description, price_minor, currency, stock, url, on_chain_status')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, product: data });
}
