import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/rrg/brand-auth';
import { db, claimNextTokenId, getBrandById, getCurrentNetwork, RRG_BRAND_ID } from '@/lib/rrg/db';
import { getRRGContract, toUsdc6dp } from '@/lib/rrg/contract';
import { uploadSubmissionFile, jpegStoragePath, additionalFileStoragePath, additionalFilesPath, physicalImageStoragePath } from '@/lib/rrg/storage';
import { calculateSplit } from '@/lib/rrg/splits';
import { autopostApproval } from '@/lib/rrg/autopost';
import { getSignedUrl } from '@/lib/rrg/storage';
import { analyzeBrandImageQuality } from '@/lib/rrg/vision';
import { randomUUID } from 'crypto';
import { isValidShippingRegion } from '@/lib/rrg/physical-product';
import type { ShippingType } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

// ── Image format detection from magic bytes ─────────────────────────
function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
}
function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
}
function detectImageFormat(buf: Buffer): { ext: 'jpg' | 'png'; mimeType: string } | null {
  if (isJpegBuffer(buf)) return { ext: 'jpg', mimeType: 'image/jpeg' };
  if (isPngBuffer(buf))  return { ext: 'png', mimeType: 'image/png' };
  return null;
}

// POST /api/brand/[brandId]/products/create — brand self-lists a product
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await params;
  const auth = await requireBrandAuth(brandId);
  if ('error' in auth) return auth.error;

  try {
    // Get the brand
    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    if (brand.status !== 'active') {
      return NextResponse.json({ error: 'Brand is not active' }, { status: 403 });
    }

    // Check self-listing cap
    if (brand.self_listings_used >= brand.max_self_listings) {
      return NextResponse.json({
        error: `Self-listing cap reached (${brand.max_self_listings}). Contact RRG to increase.`
      }, { status: 403 });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const title         = formData.get('title') as string;
    const description   = formData.get('description') as string | null;
    const priceStr      = formData.get('price_usdc') as string;
    const editionStr    = formData.get('edition_size') as string;
    const contactEmail  = formData.get('contact_email') as string | null;
    const jpeg          = formData.get('jpeg') as File | null;

    // Voucher template
    const voucherTemplateId      = formData.get('voucher_template_id') as string | null;

    // Physical product fields
    const isPhysicalProduct      = formData.get('is_physical_product') === '1';
    const physicalDescription    = formData.get('physical_description') as string | null;
    const priceIncludesTax       = formData.get('price_includes_tax') === '1';
    const priceIncludesPacking   = formData.get('price_includes_packing') === '1';
    const ecommerceUrl           = formData.get('ecommerce_url') as string | null;
    const shippingTypeRaw        = formData.get('shipping_type') as string | null;
    const shippingRegionsRaw     = formData.get('shipping_included_regions') as string | null;
    const refundCommitment       = formData.get('refund_commitment') === '1';
    const collectionInPerson     = formData.get('collection_in_person') as string | null;
    const trustBehaviorAccepted  = formData.get('trust_behavior_accepted') === '1';

    // Collect physical images (up to 4)
    const physicalImageFiles: File[] = [];
    for (const [key, val] of formData.entries()) {
      if (key === 'physical_images' && val instanceof File && val.size > 0) {
        physicalImageFiles.push(val);
      }
    }

    // Collect additional files
    const additionalFiles: File[] = [];
    for (const [key, val] of formData.entries()) {
      if (key === 'additional_files' && val instanceof File && val.size > 0) {
        additionalFiles.push(val);
      }
    }

    // Validate additional files total size (5 MB)
    const MAX_ADDITIONAL_SIZE = 5 * 1024 * 1024;
    const additionalTotalSize = additionalFiles.reduce((sum, f) => sum + f.size, 0);
    if (additionalTotalSize > MAX_ADDITIONAL_SIZE) {
      return NextResponse.json(
        { error: `Additional files total must be under 5 MB (got ${(additionalTotalSize / 1024 / 1024).toFixed(1)} MB)` },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!title || title.trim().length > 60) {
      return NextResponse.json({ error: 'title is required (max 60 chars)' }, { status: 400 });
    }

    const priceUsdc   = parseFloat(priceStr);
    const editionSize = parseInt(editionStr, 10);

    if (!priceUsdc || priceUsdc < 0.01 || priceUsdc > 500) {
      return NextResponse.json({ error: 'price_usdc must be 0.01–500.00' }, { status: 400 });
    }
    if (!editionSize || editionSize < 1 || editionSize > 500) {
      return NextResponse.json({ error: 'edition_size must be 1–500' }, { status: 400 });
    }

    if (!jpeg) {
      return NextResponse.json({ error: 'JPEG or PNG image required' }, { status: 400 });
    }

    // ── Validate physical product fields ────────────────────────────────
    let shippingType: ShippingType | null = null;
    let shippingIncludedRegions: string[] | null = null;

    if (isPhysicalProduct) {
      if (!refundCommitment) {
        return NextResponse.json({ error: 'Refund commitment is required for physical products' }, { status: 400 });
      }
      if (!trustBehaviorAccepted) {
        return NextResponse.json({ error: 'Trust & behavior acceptance is required for physical products' }, { status: 400 });
      }
      if (!shippingTypeRaw || !['included', 'live_rates'].includes(shippingTypeRaw)) {
        return NextResponse.json({ error: 'Shipping type is required for physical products (included or live_rates)' }, { status: 400 });
      }
      shippingType = shippingTypeRaw as ShippingType;

      if (shippingType === 'included') {
        const regions = shippingRegionsRaw ? shippingRegionsRaw.split(',').map(r => r.trim()).filter(Boolean) : [];
        if (regions.length === 0) {
          return NextResponse.json({ error: 'At least one shipping region is required when shipping is included' }, { status: 400 });
        }
        for (const r of regions) {
          if (!isValidShippingRegion(r)) {
            return NextResponse.json({ error: `Invalid shipping region: ${r}` }, { status: 400 });
          }
        }
        shippingIncludedRegions = regions;
      }

      if (shippingType === 'live_rates') {
        if (!brand.shopify_domain) {
          return NextResponse.json({ error: 'Live carrier rates require a connected Shopify store on this brand' }, { status: 400 });
        }
        const variantGid = (formData.get('shopify_variant_gid') as string | null)?.trim();
        if (!variantGid) {
          return NextResponse.json({ error: 'shopify_variant_gid is required when shipping_type is live_rates' }, { status: 400 });
        }
      }

      if (physicalImageFiles.length > 4) {
        return NextResponse.json({ error: 'Maximum 4 physical product images' }, { status: 400 });
      }
    }

    // Validate voucher template belongs to this brand
    if (voucherTemplateId) {
      const { data: vt } = await db
        .from('rrg_voucher_templates')
        .select('id')
        .eq('id', voucherTemplateId)
        .eq('brand_id', brandId)
        .eq('status', 'active')
        .single();
      if (!vt) {
        return NextResponse.json({ error: 'Invalid or inactive voucher template' }, { status: 400 });
      }
    }

    // Read and validate image
    const imageBuffer = Buffer.from(await jpeg.arrayBuffer());
    const format = detectImageFormat(imageBuffer);
    if (!format) {
      return NextResponse.json({ error: 'Image must be a JPEG or PNG' }, { status: 400 });
    }
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 });
    }

    // ── Upload to storage ─────────────────────────────────────────────
    const submissionId = randomUUID();
    const filename     = `brand-${Date.now()}.${format.ext}`;
    const jpegPath     = jpegStoragePath(submissionId, filename);
    await uploadSubmissionFile(jpegPath, imageBuffer, format.mimeType);

    // ── Upload physical product images ────────────────────────────────
    const physicalImagesPaths: string[] = [];
    if (isPhysicalProduct && physicalImageFiles.length > 0) {
      for (let i = 0; i < physicalImageFiles.length; i++) {
        const pFile = physicalImageFiles[i];
        const pBuf = Buffer.from(await pFile.arrayBuffer());
        const pFormat = detectImageFormat(pBuf);
        if (!pFormat) continue; // skip non-image files silently
        if (pBuf.length > 5 * 1024 * 1024) continue; // skip oversized
        const safeName = pFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const pPath = physicalImageStoragePath(submissionId, i, safeName);
        await uploadSubmissionFile(pPath, pBuf, pFormat.mimeType);
        physicalImagesPaths.push(pPath);
      }
    }

    // ── Upload additional files ────────────────────────────────────────
    let additionalPath: string | null = null;
    let additionalSizeBytes: number | null = null;

    if (additionalFiles.length > 0) {
      for (const file of additionalFiles) {
        const buf = Buffer.from(await file.arrayBuffer());
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = additionalFileStoragePath(submissionId, safeName);
        await uploadSubmissionFile(storagePath, buf, file.type || 'application/octet-stream');
      }
      additionalPath = additionalFilesPath(submissionId);
      additionalSizeBytes = additionalTotalSize;
    }

    // ── Vision quality gate ───────────────────────────────────────────
    // Runs synchronously so brand gets immediate feedback.
    // Fails-open: if Box is unreachable, pass = true and listing proceeds.
    const qualityResult = await analyzeBrandImageQuality(imageBuffer);
    if (!qualityResult.pass) {
      // Upload the image so superadmin can see it in the VERIFY queue
      const flaggedId       = randomUUID();
      const flaggedFilename = `brand-${Date.now()}.${format.ext}`;
      const flaggedPath     = jpegStoragePath(flaggedId, flaggedFilename);
      await uploadSubmissionFile(flaggedPath, imageBuffer, format.mimeType);

      await db.from('rrg_submissions').insert({
        id:                  flaggedId,
        creator_wallet:      brand.wallet_address.toLowerCase(),
        creator_email:       contactEmail?.trim() || brand.contact_email,
        title:               title.trim(),
        description:         description?.trim().slice(0, 1500) || null,
        submission_channel:  'brand',
        status:              'needs_review',
        jpeg_storage_path:   flaggedPath,
        jpeg_filename:       flaggedFilename,
        jpeg_size_bytes:     imageBuffer.length,
        brand_id:            brandId,
        creator_type:        'human',
        is_brand_product:    true,
        ai_screened_at:      new Date().toISOString(),
        ai_screen_result:    'fail',
        ai_screen_reason:    qualityResult.reason,
        image_review_flags:  qualityResult.flags,
        rejected_reason:     `[IMAGE FLAGGED] ${qualityResult.flags.join(', ')}: ${qualityResult.reason}`,
        network:             getCurrentNetwork(),
      });

      return NextResponse.json({
        error:          'Your image requires review before it can be listed.',
        review_reason:  qualityResult.reason,
        flags:          qualityResult.flags,
        message:        'Our team has been notified and will review your image within 24 hours.',
      }, { status: 422 });
    }

    // ── Calculate split ───────────────────────────────────────────────
    const split = calculateSplit({
      totalUsdc:        priceUsdc,
      brandId,
      creatorWallet:    brand.wallet_address,
      brandWallet:      brand.wallet_address,
      isBrandProduct:   true,
      isLegacy:         false,
      brandPctOverride: brand.brand_pct_override ?? null,
    });

    // ── Claim token ID ────────────────────────────────────────────────
    const tokenId = await claimNextTokenId();

    // ── Register drop on-chain ────────────────────────────────────────
    const contract = getRRGContract();
    const price6dp = toUsdc6dp(priceUsdc);

    const tx = await contract.registerDrop(
      tokenId,
      split.onChainCreator,
      price6dp,
      editionSize,
    );
    const receipt = await tx.wait(1);

    // ── Insert submission record ──────────────────────────────────────
    const { error: insertError } = await db
      .from('rrg_submissions')
      .insert({
        id:                submissionId,
        creator_wallet:    brand.wallet_address.toLowerCase(),
        creator_email:     contactEmail?.trim() || brand.contact_email,
        title:             title.trim(),
        description:       description?.trim().slice(0, 1500) || null,
        submission_channel:'brand',
        status:            'approved',
        jpeg_storage_path: jpegPath,
        jpeg_filename:     filename,
        jpeg_size_bytes:   imageBuffer.length,
        additional_files_path:       additionalPath,
        additional_files_size_bytes: additionalSizeBytes,
        brand_id:          brandId,
        creator_type:      'human',
        is_brand_product:  true,
        token_id:          tokenId,
        edition_size:      editionSize,
        price_usdc:        priceUsdc.toFixed(2),
        approved_at:       new Date().toISOString(),
        network:           getCurrentNetwork(),
        // Physical product fields
        is_physical_product:       isPhysicalProduct,
        physical_description:      isPhysicalProduct ? physicalDescription?.trim().slice(0, 1000) || null : null,
        physical_images_paths:     physicalImagesPaths.length > 0 ? physicalImagesPaths : null,
        price_includes_tax:        isPhysicalProduct ? priceIncludesTax : false,
        price_includes_packing:    isPhysicalProduct ? priceIncludesPacking : false,
        ecommerce_url:             isPhysicalProduct ? ecommerceUrl?.trim() || null : null,
        shipping_type:             shippingType,
        shipping_included_regions: shippingIncludedRegions,
        shopify_variant_gid:       isPhysicalProduct && shippingType === 'live_rates'
                                     ? (formData.get('shopify_variant_gid') as string).trim()
                                     : null,
        refund_commitment:         isPhysicalProduct ? refundCommitment : false,
        collection_in_person:      isPhysicalProduct ? collectionInPerson?.trim() || null : null,
        trust_behavior_accepted:   isPhysicalProduct ? trustBehaviorAccepted : false,
        // Voucher
        has_voucher:               !!voucherTemplateId,
        voucher_template_id:       voucherTemplateId || null,
      });

    if (insertError) throw insertError;

    // ── Increment self_listings_used ──────────────────────────────────
    await db
      .from('rrg_brands')
      .update({ self_listings_used: brand.self_listings_used + 1 })
      .eq('id', brandId);

    // ── Autopost (non-blocking) ──────────────────────────────────────
    getSignedUrl(jpegPath, 300)
      .then((imageUrl) =>
        autopostApproval({
          title:       title.trim(),
          tokenId,
          editionSize,
          priceUsdc:   priceUsdc.toFixed(2),
          description: description?.trim() ?? null,
          creatorBio:  null,
          briefTitle:  null,
          imageUrl,
        })
      )
      .catch((err) => console.error('[brand/products/create] autopost failed:', err));

    return NextResponse.json({
      success: true,
      tokenId,
      txHash:  receipt.hash,
      dropUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/rrg/drop/${tokenId}`,
    }, { status: 201 });

  } catch (err) {
    console.error('[/api/brand/[brandId]/products/create]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
