import { NextRequest, NextResponse } from 'next/server';
import { db, getCurrentNetwork, type ShippingType } from '@/lib/rrg/db';
import { isAdminFromCookies, isAdminReader, adminUnauthorized } from '@/lib/rrg/auth';
import {
  getSignedUrlsBatch,
  jpegStoragePath,
  physicalImageStoragePath,
  deleteFile,
  uploadSubmissionFile,
} from '@/lib/rrg/storage';
import { detectImageFormat } from '@/lib/rrg/agentmail';
import { isValidShippingRegion } from '@/lib/rrg/physical-product';

export const dynamic = 'force-dynamic';

// GET /api/rrg/admin/drops: paginated list of approved drops (including hidden).
// Full admin (cookie / x-admin-secret) or read-only (x-admin-readonly-secret).
// Query params:
//   page       (default 1)
//   limit      (default 50, max 200)
//   brand_id   ("all" | brand uuid)
//   type       ("all" | "digital" | "physical" | "voucher")
//   visibility ("all" | "storefront" | "mcp_only" | "hidden")
// Returns { drops, page, limit, total, totals: { storefront, mcp_only, hidden } }.
// `totals` reflects the visibility breakdown of the current brand+type filter,
// independent of the visibility filter so the header counts stay stable.
export async function GET(req: Request) {
  if (!(await isAdminReader(req))) return adminUnauthorized();

  try {
    const url = new URL(req.url);
    const pageRaw   = parseInt(url.searchParams.get('page')  || '1', 10);
    const limitRaw  = parseInt(url.searchParams.get('limit') || '50', 10);
    const page  = Number.isFinite(pageRaw)  && pageRaw  > 0 ? pageRaw  : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const brandId    = url.searchParams.get('brand_id')   || 'all';
    const typeFilter = (url.searchParams.get('type')       || 'all') as 'all' | 'digital' | 'physical' | 'voucher';
    const visFilter  = (url.searchParams.get('visibility') || 'all') as 'all' | 'storefront' | 'mcp_only' | 'hidden';

    const network = getCurrentNetwork();
    // Filter chain inlined twice (page query + totals) so we don't fight
    // supabase-js's per-method generic types with a shared helper.
    let pageQuery = db.from('rrg_submissions').select('*', { count: 'exact' })
      .eq('status', 'approved')
      .eq('network', network);
    if (brandId !== 'all')             pageQuery = pageQuery.eq('brand_id', brandId);
    if (typeFilter === 'physical')     pageQuery = pageQuery.eq('is_physical_product', true);
    else if (typeFilter === 'voucher') pageQuery = pageQuery.eq('has_voucher', true);
    else if (typeFilter === 'digital') pageQuery = pageQuery.eq('is_physical_product', false).eq('has_voucher', false);
    if (visFilter === 'hidden')          pageQuery = pageQuery.eq('hidden', true);
    else if (visFilter === 'mcp_only')   pageQuery = pageQuery.eq('hidden', false).eq('ui_visible', false);
    else if (visFilter === 'storefront') pageQuery = pageQuery.eq('hidden', false).eq('ui_visible', true);

    const from = (page - 1) * limit;
    const to   = from + limit - 1;
    const { data, count, error } = await pageQuery
      .order('approved_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = data ?? [];

    // Visibility totals across the current brand+type filter (visibility filter
    // is intentionally not applied here so header counts stay stable as the
    // user flips between visibility states).
    const totalBase = () => {
      let q = db.from('rrg_submissions').select('*', { count: 'exact', head: true })
        .eq('status', 'approved')
        .eq('network', network);
      if (brandId !== 'all')             q = q.eq('brand_id', brandId);
      if (typeFilter === 'physical')     q = q.eq('is_physical_product', true);
      else if (typeFilter === 'voucher') q = q.eq('has_voucher', true);
      else if (typeFilter === 'digital') q = q.eq('is_physical_product', false).eq('has_voucher', false);
      return q;
    };
    const [storefrontTot, mcpOnlyTot, hiddenTot] = await Promise.all([
      totalBase().eq('hidden', false).eq('ui_visible', true),
      totalBase().eq('hidden', false).eq('ui_visible', false),
      totalBase().eq('hidden', true),
    ]);

    // Batch-sign preview + physical image paths for the current page in one call.
    const allPaths: string[] = [];
    for (const d of rows) {
      if (typeof d.jpeg_storage_path === 'string') allPaths.push(d.jpeg_storage_path);
      if (Array.isArray(d.physical_images_paths)) {
        for (const p of d.physical_images_paths) if (typeof p === 'string') allPaths.push(p);
      }
    }
    const urlMap = allPaths.length > 0
      ? await getSignedUrlsBatch(allPaths)
      : new Map<string, string>();

    const withUrls = rows.map((d) => ({
      ...d,
      previewUrl: typeof d.jpeg_storage_path === 'string'
        ? (urlMap.get(d.jpeg_storage_path) ?? null)
        : null,
      physicalImageUrls: Array.isArray(d.physical_images_paths)
        ? d.physical_images_paths.map((p: string) => urlMap.get(p) ?? null)
        : [],
    }));

    return NextResponse.json({
      drops: withUrls,
      page,
      limit,
      total: count ?? 0,
      totals: {
        storefront: storefrontTot.count ?? 0,
        mcp_only:   mcpOnlyTot.count   ?? 0,
        hidden:     hiddenTot.count    ?? 0,
      },
    });
  } catch (err) {
    console.error('[/api/rrg/admin/drops GET]', err);
    return NextResponse.json({ error: 'Failed to load drops' }, { status: 500 });
  }
}

// PATCH /api/rrg/admin/drops: super-admin edit of drop fields + optional image replacement
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
