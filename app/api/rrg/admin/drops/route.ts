import { NextRequest, NextResponse } from 'next/server';
import { db, getCurrentNetwork, type ShippingType } from '@/lib/rrg/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import {
  getSignedUrl,
  getSignedUrlsBatch,
  jpegStoragePath,
  physicalImageStoragePath,
  deleteFile,
  uploadSubmissionFile,
} from '@/lib/rrg/storage';
import { detectImageFormat } from '@/lib/rrg/agentmail';
import { isValidShippingRegion } from '@/lib/rrg/physical-product';

export const dynamic = 'force-dynamic';

// GET /api/rrg/admin/drops — super-admin: list ALL approved drops (including hidden)
export async function GET() {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  try {
    // PostgREST caps each request at 1000 rows by default. Without chunking the
    // admin counter read "0 of 1000" and the brand/storefront filters silently
    // dropped older drops. Page through the table until exhausted.
    const PAGE_SIZE = 1000;
    type DropRow = Awaited<ReturnType<typeof fetchPage>>[number];
    async function fetchPage(from: number) {
      const { data, error } = await db
        .from('rrg_submissions')
        .select('*')
        .eq('status', 'approved')
        .eq('network', getCurrentNetwork())
        .order('approved_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    }
    const data: DropRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const chunk = await fetchPage(from);
      if (chunk.length === 0) break;
      data.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
    }

    // Batch-sign all physical_images_paths in one Supabase call.
    const allPhysicalPaths: string[] = [];
    for (const d of data) {
      if (Array.isArray(d.physical_images_paths)) {
        for (const p of d.physical_images_paths) if (typeof p === 'string') allPhysicalPaths.push(p);
      }
    }
    const physicalUrlMap = allPhysicalPaths.length > 0
      ? await getSignedUrlsBatch(allPhysicalPaths)
      : new Map<string, string>();

    // Attach signed preview URLs (and physical image URLs)
    const withUrls = await Promise.all(
      data.map(async (d) => {
        let previewUrl: string | null = null;
        try {
          if (d.jpeg_storage_path) {
            previewUrl = await getSignedUrl(d.jpeg_storage_path, 3600);
          }
        } catch {
          // non-fatal
        }
        const physicalImageUrls = Array.isArray(d.physical_images_paths)
          ? d.physical_images_paths.map((p: string) => physicalUrlMap.get(p) ?? null)
          : [];
        return { ...d, previewUrl, physicalImageUrls };
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
    let physicalImageFiles: File[] = [];
    let physicalImagesRemove: string[] = [];
    let physicalImagesTouched = false; // true if either add or remove was requested

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

      // ── Physical product text/boolean fields ──────────────────────
      const physical_description = formData.get('physical_description');
      const ecommerce_url        = formData.get('ecommerce_url');
      const collection_in_person = formData.get('collection_in_person');
      const price_includes_tax   = formData.get('price_includes_tax');
      const price_includes_packing = formData.get('price_includes_packing');
      const refund_commitment    = formData.get('refund_commitment');
      const trust_behavior_accepted = formData.get('trust_behavior_accepted');
      const shipping_type        = formData.get('shipping_type');
      const shipping_included_regions = formData.get('shipping_included_regions');

      if (physical_description !== null) {
        const v = (physical_description as string).trim();
        updates.physical_description = v.length > 0 ? v.slice(0, 1000) : null;
      }
      if (ecommerce_url !== null) {
        const v = (ecommerce_url as string).trim();
        updates.ecommerce_url = v.length > 0 ? v : null;
      }
      if (collection_in_person !== null) {
        const v = (collection_in_person as string).trim();
        updates.collection_in_person = v.length > 0 ? v : null;
      }
      if (price_includes_tax !== null) updates.price_includes_tax = price_includes_tax === 'true' || price_includes_tax === '1';
      if (price_includes_packing !== null) updates.price_includes_packing = price_includes_packing === 'true' || price_includes_packing === '1';
      if (refund_commitment !== null) updates.refund_commitment = refund_commitment === 'true' || refund_commitment === '1';
      if (trust_behavior_accepted !== null) updates.trust_behavior_accepted = trust_behavior_accepted === 'true' || trust_behavior_accepted === '1';

      if (shipping_type !== null) {
        const raw = (shipping_type as string).trim();
        if (raw === '' || raw === 'null') {
          updates.shipping_type = null;
        } else if (raw === 'included' || raw === 'live_rates') {
          updates.shipping_type = raw as ShippingType;
        } else {
          return NextResponse.json({ error: 'shipping_type must be included, live_rates, or null' }, { status: 400 });
        }
      }
      if (shipping_included_regions !== null) {
        const raw = (shipping_included_regions as string).trim();
        if (raw === '') {
          updates.shipping_included_regions = null;
        } else {
          const regions = raw.split(',').map(r => r.trim()).filter(Boolean);
          for (const r of regions) {
            if (!isValidShippingRegion(r)) {
              return NextResponse.json({ error: `Invalid shipping region: ${r}` }, { status: 400 });
            }
          }
          updates.shipping_included_regions = regions.length > 0 ? regions : null;
        }
      }

      // ── Physical image gallery edits ──────────────────────────────
      const removeRaw = formData.get('physical_images_remove');
      if (removeRaw !== null) {
        physicalImagesRemove = (removeRaw as string).split(',').map(s => s.trim()).filter(Boolean);
        physicalImagesTouched = physicalImagesTouched || physicalImagesRemove.length > 0;
      }
      for (const [key, val] of formData.entries()) {
        if (key === 'physical_images' && val instanceof File && val.size > 0) {
          physicalImageFiles.push(val);
        }
      }
      if (physicalImageFiles.length > 0) physicalImagesTouched = true;
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

    // ── Physical image gallery: delete removed, upload new, write merged array ──
    if (physicalImagesTouched) {
      const { data: row, error: rowErr } = await db
        .from('rrg_submissions')
        .select('physical_images_paths')
        .eq('id', submissionId)
        .single();
      if (rowErr) throw rowErr;
      const existing: string[] = Array.isArray(row?.physical_images_paths) ? row.physical_images_paths : [];

      const removeSet = new Set(physicalImagesRemove);
      const kept = existing.filter((p) => !removeSet.has(p));

      const totalAfter = kept.length + physicalImageFiles.length;
      if (totalAfter > 4) {
        return NextResponse.json({ error: `Maximum 4 physical images (would result in ${totalAfter})` }, { status: 400 });
      }

      // Delete removed files from storage (don't fail the request on storage errors)
      for (const p of physicalImagesRemove) {
        try { await deleteFile(p); } catch (e) { console.error('[admin/drops] deleteFile failed', p, e); }
      }

      // Upload new files, picking fresh indices that don't collide with kept paths
      const usedIndices = new Set<number>();
      for (const p of kept) {
        const m = p.match(/\/physical\/(\d+)-/);
        if (m) usedIndices.add(parseInt(m[1], 10));
      }
      let nextIndex = 0;
      const newPaths: string[] = [];
      for (const f of physicalImageFiles) {
        const buf = Buffer.from(await f.arrayBuffer());
        const fmt = detectImageFormat(buf);
        if (!fmt) {
          return NextResponse.json({ error: `physical_images must be JPEG or PNG (${f.name})` }, { status: 400 });
        }
        if (buf.length > 5 * 1024 * 1024) {
          return NextResponse.json({ error: `physical_images must be under 5 MB (${f.name})` }, { status: 400 });
        }
        while (usedIndices.has(nextIndex)) nextIndex++;
        const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const pPath = physicalImageStoragePath(submissionId, nextIndex, safeName);
        await uploadSubmissionFile(pPath, buf, fmt.mimeType);
        newPaths.push(pPath);
        usedIndices.add(nextIndex);
      }

      const merged = [...kept, ...newPaths];
      updates.physical_images_paths = merged.length > 0 ? merged : null;
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
