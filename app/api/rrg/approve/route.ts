import { NextRequest, NextResponse } from 'next/server';
import { db, claimNextTokenId, getSubmissionById, getCurrentNetwork, getBrandById, RRG_BRAND_ID } from '@/lib/rrg/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import { getRRGContract, toUsdc6dp } from '@/lib/rrg/contract';
import { sendApprovalNotification } from '@/lib/rrg/email';
import { getSignedUrl } from '@/lib/rrg/storage';
import { autopostApproval } from '@/lib/rrg/autopost';
import { sendInstagramNotification } from '@/lib/rrg/instagram';
import { calculateSplit } from '@/lib/rrg/splits';

export const dynamic = 'force-dynamic';

// POST /api/rrg/approve — admin only
// Body: { submissionId, edition_size, price_usdc }
export async function POST(req: NextRequest) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

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
    // Allow approval of pending, ai_rejected (override), and needs_review (brand image verified)
    const approvableStatuses = ['pending', 'ai_rejected', 'needs_review'];
    if (!approvableStatuses.includes(submission.status)) {
      return NextResponse.json({ error: `Submission is already ${submission.status}` }, { status: 409 });
    }

    // ── Claim next token ID ───────────────────────────────────────────
    const tokenId = await claimNextTokenId();

    // ── Calculate revenue split ─────────────────────────────────────
    const brandId = submission.brand_id ?? RRG_BRAND_ID;
    const brand   = brandId !== RRG_BRAND_ID ? await getBrandById(brandId) : null;
    const isLegacy = false; // New approvals are never legacy

    const split = calculateSplit({
      totalUsdc:        priceUsdc,
      brandId,
      creatorWallet:    submission.creator_wallet,
      brandWallet:      brand?.wallet_address ?? null,
      isBrandProduct:   submission.is_brand_product ?? false,
      isLegacy,
      brandPctOverride: brand?.brand_pct_override ?? null,
    });

    // ── Register drop on-chain ────────────────────────────────────────
    const contract  = getRRGContract();
    const price6dp  = toUsdc6dp(priceUsdc);

    const tx = await contract.registerDrop(
      tokenId,
      split.onChainCreator, // platform wallet for multi-brand, creator for legacy
      price6dp,
      editionSize
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
          to:           submission.creator_email,
          title:        submission.title,
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
        // Non-fatal — log but don't fail the approval
        console.error('[approve] Email notification failed:', emailErr);
      }
    }

    // ── Autopost + Instagram notify (non-blocking) ───────────────────────
    // Look up the brief the submission was actually linked to (NOT getCurrentBrief)
    Promise.resolve(
      submission.brief_id
        ? db.from('rrg_briefs').select('title').eq('id', submission.brief_id).single().then(r => r.data)
        : null
    ).then(async (brief) => {
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
        briefTitle:  brief?.title ?? null,
        imageUrl,
      });

      // Instagram notification email
      sendInstagramNotification({
        trigger:       'new_drop',
        title:         submission.title,
        tokenId,
        creatorHandle: submission.creator_handle ?? null,
        creatorType:   (submission.creator_type as 'human' | 'agent') ?? 'human',
        briefName:     brief?.title ?? null,
        brandName:     brand?.name ?? null,
        imageUrl,
      }).catch((err) => console.error('[approve] instagram notify failed:', err));
    }).catch((err) => console.error('[approve] autopost failed:', err));

    return NextResponse.json({
      success:          true,
      tokenId,
      txHash:           receipt.hash,
      notificationSent,
      dropUrl:          `${process.env.NEXT_PUBLIC_SITE_URL}/rrg/listing/${tokenId}`,
    });

  } catch (err) {
    console.error('[/api/rrg/approve]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
