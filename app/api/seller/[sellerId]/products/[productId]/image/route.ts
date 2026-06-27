import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

// Public bucket for product images (world-readable; safe, these are shopfront
// pictures). Distinct from the private app-digital-assets bucket that holds
// paid deliverables.
const BUCKET = 'app-product-images';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
]);

/**
 * POST /api/seller/[sellerId]/products/[productId]/image
 *   Upload a product image (multipart form-data, field `file`). Stores it in
 *   the public app-product-images bucket and writes the public URL onto
 *   app_seller_products.image_url so it shows on the storefront, in the MCP
 *   results, and in the superadmin moderation view. Owner-gated.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  // The product must belong to this seller.
  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

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
  const path = `sellers/${sellerId}/products/${productId}/cover.${ext}`;

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
    .eq('seller_id', sellerId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ image_url: imageUrl });
}
