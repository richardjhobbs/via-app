import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { DIGITAL_BUCKET, digitalFileStoragePath, getDigitalFiles } from '@/lib/app/digital-delivery';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/seller/[sellerId]/products/[productId]/deliverable
 *
 * Upload the MAIN ASSET of a digital product (image / pdf / mp3 / mp4 / zip /
 * etc) as multipart form-data, field `file`. The asset is the paid deliverable:
 * it lands in the PRIVATE app-digital-assets bucket and is recorded on
 * metadata.digital_files, so get_download_links serves it (signed, 24h) only
 * after a settled purchase. Nothing about it is made public, so a digital image
 * asset is never given away for free (paid-door invariant). Owner-gated, and
 * only valid for kind='digital' products.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id, kind, metadata')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  if (product.kind !== 'digital') {
    return NextResponse.json({ error: 'Only digital products take a deliverable asset' }, { status: 409 });
  }

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
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Asset must be 50 MB or smaller' }, { status: 413 });
  }

  const filename    = file.name || 'asset';
  const contentType = file.type || 'application/octet-stream';
  const buffer      = Buffer.from(await file.arrayBuffer());
  const path        = digitalFileStoragePath(sellerId, productId, filename);

  const { error: upErr } = await db.storage
    .from(DIGITAL_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 502 });

  // One main asset per product: record just this file, and remove any previous
  // deliverable objects whose key differs so the bucket never accrues orphans.
  const prior = getDigitalFiles(product.metadata);
  const stalePaths = prior.map((f) => f.path).filter((p) => p !== path);
  if (stalePaths.length > 0) {
    const { error: rmErr } = await db.storage.from(DIGITAL_BUCKET).remove(stalePaths);
    if (rmErr) console.error('[deliverable] stale asset cleanup failed', { stalePaths, err: rmErr.message });
  }

  const metadata = { ...(product.metadata as Record<string, unknown> ?? {}), digital_files: [{ path, filename, content_type: contentType }] };

  // A digital asset is never public. Null out any public image_url/url so the
  // paid asset cannot leak onto the storefront or MCP results.
  const { error: updErr } = await db
    .from('app_seller_products')
    .update({ metadata, image_url: null, url: null, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('seller_id', sellerId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    filename,
    content_type: contentType,
    is_image:     contentType.startsWith('image/'),
  });
}
