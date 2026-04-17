import { NextRequest, NextResponse } from 'next/server';
import { db, claimNextTokenId, getSubmissionById, getCurrentNetwork, getBrandById, RRG_BRAND_ID } from '@/lib/rrg/db';
import { requireBrandAuth } from '@/lib/rrg/brand-auth';
import { getRRGContract, toUsdc6dp } from '@/lib/rrg/contract';
import { sendApprovalNotification } from '@/lib/rrg/email';
import { getSignedUrl } from '@/lib/rrg/storage';
import { autopostApproval } from '@/lib/rrg/autopost';
import { calculateSplit } from '@/lib/rrg/splits';

export const dynamic = 'force-dynamic';

// POST /api/brand/[brandId]/approve — brand admin approves a submission
// Body: { submissionId, edition_size, price_usdc }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId } = await params;
  const auth = await requireBrandAuth(brandId);
  if ('error' in auth) return auth.error;

  try {
    const { submissionId, edition_size, price_usdc } = await req.json();

    if (!submissionId) {
      return NextResponse.json({ error: 'submissionId required' }, { status: 400 });
    }

    const editionSize = parseInt(edition_size, 10);
    const priceUsdc   = parseFloat(price_usdc);

    if (!editionSize || editionSize < 1 || editionSize > 50) {
      return NextResponse.json({ error: 'edition_size must be 1–50' }, { status: 400 });
    }
    if (!priceUsdc || priceUsdc < 0.1 || priceUsdc > 500) {
      return NextResponse.json({ error: 'price_usdc must be 0.10–500.00' }, { status: 400 });
    }

    const submission = await getSubmissionById(submissionId);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }
    if (submission.brand_id !== brandId) {
      return NextResponse.json({ error: 'Submission does not belong to this brand' }, { status: 403 });
    }
    if (submission.status !== 'pending') {
      return NextResponse.json({ error: `Submission is already ${submission.status}` }, { status: 409 });
    }

    // ── Claim next token ID ───────────────────────────────────────────
    const tokenId = await claimNextTokenId();

    // ── Calculate revenue split ─────────────────────────────────────
    const brand = brandId !== RRG_BRAND_ID ? await getBrandById(brandId) : null;

    const split = calculateSplit({
      totalUsdc:        priceUsdc,
      brandId,
      creatorWallet:    submission.creator_wallet,
      brandWallet:      brand?.wallet_address ?? null,
      isBrandProduct:   false,
      isLegacy:         false,
      brandPctOverride: brand?.brand_pct_override ?? null,
    });

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

    // ── Update DB ─────────────────────────────────────────────────────
    await db
      .from('rrg_submissions')
      .update({
        status:       'approved',
        token_id:     tokenId,
        edition_size: editionSize,
        price_usdc:   priceUsdc.toFixed(2),
        approved_at:  new Date().toISOString(),
        network:      getCurrentNetwork(),
      })
      .eq('id', submissionId);

    // ── Send approval notification ────────────────────────────────────
    let notificationSent = false;
    if (submission.creator_email) {
      try {
        await sendApprovalNotification({
          to:            submission.creator_email,
          title:         submission.title,
          tokenId,
          priceUsdc,
          editionSize,
          creatorWallet: submission.creator_wallet,
        });
        await db
          .from('rrg_submissions')
          .update({ approval_notification_sent: true })
          .eq('id', submissionId);
        notificationSent = true;
      } catch (emailErr) {
        console.error(`[brand/${brandId}/approve] Email notification failed:`, emailErr);
      }
    }

    // ── Autopost new listing (non-blocking) ─────────────────────────────
    (async () => {
      try {
        const imageUrl = submission.jpeg_storage_path
          ? await getSignedUrl(submission.jpeg_storage_path, 300).catch(() => null)
          : null;
        await autopostApproval({
          title:       submission.title,
          tokenId,
          editionSize,
          priceUsdc:   priceUsdc.toFixed(2),
          description: submission.description ?? null,
          creatorBio:  submission.creator_bio ?? null,
          briefTitle:  null,
          imageUrl,
        });
      } catch (err) {
        console.error(`[brand/${brandId}/approve] autopost failed:`, err);
      }
    })();

    return NextResponse.json({
      success:          true,
      tokenId,
      txHash:           receipt.hash,
      notificationSent,
      splitType:        split.splitType,
      dropUrl:          `${process.env.NEXT_PUBLIC_SITE_URL}/rrg/listing/${tokenId}`,
    });

  } catch (err) {
    console.error(`[/api/brand/${brandId}/approve]`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
