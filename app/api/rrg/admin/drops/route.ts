import { NextRequest, NextResponse } from 'next/server';
import { db, getCurrentNetwork } from '@/lib/rrg/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import { getSignedUrl, jpegStoragePath } from '@/lib/rrg/storage';

export const dynamic = 'force-dynamic';

// GET /api/rrg/admin/drops — super-admin: list ALL approved drops (including hidden)
export async function GET() {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  try {
    const { data, error } = await db
      .from('rrg_submissions')
      .select('*')
      .eq('status', 'approved')
      .eq('network', getCurrentNetwork())
      .order('approved_at', { ascending: false });

    if (error) throw error;

    // Attach signed preview URLs
    const withUrls = await Promise.all(
      (data ?? []).map(async (d) => {
        let previewUrl: string | null = null;
        try {
          if (d.jpeg_storage_path) {
            previewUrl = await getSignedUrl(d.jpeg_storage_path, 3600);
          }
        } catch {
          // non-fatal
        }
        return { ...d, previewUrl };
      })
    );

    return NextResponse.json({ drops: withUrls });
  } catch (err) {
    console.error('[/api/rrg/admin/drops GET]', err);
    return NextResponse.json({ error: 'Failed to load drops' }, { status: 500 });
  }
}

// PATCH /api/rrg/admin/drops — super-admin: edit drop fields + optional image replacement
export async function PATCH(req: NextRequest) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  try {
    const contentType = req.headers.get('content-type') || '';
    let submissionId: string | undefined;
    const updates: Record<string, unknown> = {};
    let imageFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Multipart: supports image replacement
      const formData = await req.formData();
      submissionId = formData.get('submissionId') as string;

      const title = formData.get('title');
      const description = formData.get('description');
      const hidden = formData.get('hidden');
      const ui_visible = formData.get('ui_visible');
      const price_usdc = formData.get('price_usdc');
      const edition_size = formData.get('edition_size');
      const creator_email = formData.get('creator_email');
      const creator_handle = formData.get('creator_handle');
      const creator_bio = formData.get('creator_bio');
      const image = formData.get('image');

      if (title !== null) updates.title = title;
      if (description !== null) updates.description = description;
      if (hidden !== null) updates.hidden = hidden === 'true';
      if (ui_visible !== null) updates.ui_visible = ui_visible === 'true';
      if (creator_email !== null) updates.creator_email = creator_email || null;
      if (creator_handle !== null) updates.creator_handle = creator_handle || null;
      if (creator_bio !== null) updates.creator_bio = creator_bio || null;

      if (price_usdc !== null) {
        const p = parseFloat(price_usdc as string);
        if (isNaN(p) || p <= 0) return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
        updates.price_usdc = p;
      }
      if (edition_size !== null) {
        const e = parseInt(edition_size as string, 10);
        if (isNaN(e) || e < 1) return NextResponse.json({ error: 'Invalid edition size' }, { status: 400 });
        updates.edition_size = e;
      }

      if (image instanceof File && image.size > 0) {
        imageFile = image;
      }
    } else {
      // JSON body (backwards compatible)
      const body = await req.json();
      submissionId = body.submissionId;

      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.hidden !== undefined) updates.hidden = !!body.hidden;
      if (body.ui_visible !== undefined) updates.ui_visible = !!body.ui_visible;
      if (body.creator_email !== undefined) updates.creator_email = body.creator_email || null;
      if (body.creator_handle !== undefined) updates.creator_handle = body.creator_handle || null;
      if (body.creator_bio !== undefined) updates.creator_bio = body.creator_bio || null;

      if (body.price_usdc !== undefined) {
        const p = parseFloat(body.price_usdc);
        if (isNaN(p) || p <= 0) return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
        updates.price_usdc = p;
      }
      if (body.edition_size !== undefined) {
        const e = parseInt(body.edition_size, 10);
        if (isNaN(e) || e < 1) return NextResponse.json({ error: 'Invalid edition size' }, { status: 400 });
        updates.edition_size = e;
      }
    }

    if (!submissionId) {
      return NextResponse.json({ error: 'submissionId required' }, { status: 400 });
    }

    // Handle image replacement
    if (imageFile) {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      // Detect format from magic bytes
      const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
      if (!isJpeg && !isPng) {
        return NextResponse.json({ error: 'Image must be JPEG or PNG' }, { status: 400 });
      }
      const ext = isPng ? 'png' : 'jpeg';
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const filename = `admin-replaced.${ext}`;
      const storagePath = jpegStoragePath(submissionId, filename);

      // Upload with upsert
      const { error: uploadErr } = await db.storage
        .from('rrg-submissions')
        .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

      if (uploadErr) throw new Error(`Image upload failed: ${uploadErr.message}`);

      updates.jpeg_storage_path = storagePath;
      updates.jpeg_filename = filename;
      updates.jpeg_size_bytes = buffer.length;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { error } = await db
      .from('rrg_submissions')
      .update(updates)
      .eq('id', submissionId)
      .eq('status', 'approved');

    if (error) throw error;

    return NextResponse.json({ ok: true, updated: Object.keys(updates) });
  } catch (err) {
    console.error('[/api/rrg/admin/drops]', err);
    return NextResponse.json({ error: 'Failed to update drop' }, { status: 500 });
  }
}
