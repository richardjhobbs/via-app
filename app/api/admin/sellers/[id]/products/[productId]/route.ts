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
