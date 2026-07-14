import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

// Public bucket for product images (world-readable; safe, these are shopfront
// pictures). Same bucket + deterministic key the seller upload uses, so the
// superadmin overwrites the exact object the seller would.
const BUCKET = 'app-product-images';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
]);

/**
 * POST /api/admin/sellers/[id]/products/[productId]/image
 *
 * Superadmin product-image replace. Mirrors the seller upload
 * (POST /api/seller/[sellerId]/products/[productId]/image) but is admin-gated
 * rather than owner-gated. Multipart form-data, field `file`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; productId: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id, productId } = await ctx.params;

  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id')
    .eq('id', productId)
    .eq('seller_id', id)
    .maybeSingle();
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: 'product not found for this seller' }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a file field' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json({ error: 'Image must be JPEG, PNG, or WebP' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image must be 8 MB or smaller' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // One deterministic object key per product, overwritten on re-upload, so a
  // product never accumulates orphaned images and the public URL is stable.
  const path = `sellers/${id}/products/${productId}/cover.${ext}`;

  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 502 });

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  // Bust any CDN/browser cache of the previous image at this stable key.
  const imageUrl = `${pub.publicUrl}?v=${Date.now().toString(36)}`;

  const { error: updErr } = await db
    .from('app_seller_products')
    .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('seller_id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, image_url: imageUrl });
}
