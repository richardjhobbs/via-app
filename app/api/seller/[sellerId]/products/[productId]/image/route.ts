import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BUCKET = 'app-product-images';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the bucket's file_size_limit
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif':  return 'gif';
    default:           return 'bin';
  }
}

/**
 * POST /api/seller/[sellerId]/products/[productId]/image
 *
 * Accepts multipart/form-data with a single `file` field. Uploads to
 * Supabase Storage bucket `app-product-images` at the deterministic path
 * `sellers/{sellerId}/{productId}.{ext}` (upsert: true, so re-uploads
 * overwrite). Stores the resulting public URL in
 * app_seller_products.image_url.
 *
 * The bucket is public-read with a 5MB cap and image MIME types
 * enforced at the bucket level. The server-side checks below are for
 * friendly error messages before the upload round-trip.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  // Confirm the product exists and belongs to this seller before uploading.
  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id, seller_id, image_url')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Body must be multipart/form-data' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type || 'unknown'}. Allowed: jpg, png, webp, gif.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large: ${file.size} bytes. Max 5MB.` }, { status: 400 });
  }

  const ext = extFromMime(file.type);
  const path = `sellers/${sellerId}/${productId}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  // Remove the other-extension variant if it exists, so stale files don't
  // linger when the seller switches formats. Same pattern as settings/route.ts.
  const otherExts = ['jpg', 'png', 'webp', 'gif'].filter((e) => e !== ext);
  await db.storage.from(BUCKET).remove(otherExts.map((e) => `sellers/${sellerId}/${productId}.${e}`));

  const { error: uploadErr } = await db.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 502 });
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  // Cache-bust the public URL so the dashboard preview reflects the new image
  // immediately (Supabase Storage serves with long max-age by default).
  const cacheBusted = `${publicUrl}?v=${Date.now()}`;

  const { error: updErr } = await db
    .from('app_seller_products')
    .update({ image_url: cacheBusted, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('seller_id', sellerId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    product_id: productId,
    image_url:  cacheBusted,
    path,
    bytes:      file.size,
    content_type: file.type,
  });
}
