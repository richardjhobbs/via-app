import { NextRequest, NextResponse } from 'next/server';
import { db, getDropByTokenId, getCurrentNetwork, getBrandById, RRG_BRAND_ID } from '@/lib/rrg/db';
import { getRRGContract } from '@/lib/rrg/contract';
import { splitSignature } from '@/lib/rrg/permit';
import { getSignedUrl } from '@/lib/rrg/storage';
import { uploadToIpfsInBackground } from '@/lib/rrg/ipfs';
import { sendFileDeliveryEmail, sendPhysicalOrderToBrand, sendPhysicalPurchaseToBuyer } from '@/lib/rrg/email';
import { randomBytes } from 'crypto';
import { autopostSale } from '@/lib/rrg/autopost';
import { sendInstagramNotification } from '@/lib/rrg/instagram';
import { postReputationSignal, postBuyerReputationSignal, postBrandSaleSignal, fireVoucherSignal, lookupAgentIdByWallet } from '@/lib/rrg/erc8004';
import { calculateSplit } from '@/lib/rrg/splits';
import { resolveEffectivePrice } from '@/lib/rrg/pricing';
import { insertDistributionAndPay } from '@/lib/rrg/auto-payout';
import { createVoucher, formatVoucherForDisplay } from '@/lib/rrg/vouchers';
import { firePurchaseAttribution } from '@/lib/rrg/marketing-attribution';

export const dynamic = 'force-dynamic';

// POST /api/rrg/confirm — public: mintWithPermit → IPFS → deliver
// Body: { tokenId, buyerWallet, buyerEmail, deadline, signature }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tokenId, buyerWallet, buyerEmail, deadline, signature,
            shipping_name, shipping_address_line1, shipping_address_line2,
            shipping_city, shipping_state, shipping_postal_code,
            shipping_country, shipping_phone, physical_terms_accepted,
            shipping_rate_handle, shipping_rate_title, shipping_rate_amount,
            shipping_rate_currency, shipping_rate_code,
            selected_size, selected_color } = body;

    // ── Validate inputs ───────────────────────────────────────────────
    if (!tokenId || !buyerWallet || !deadline || !signature) {
      return NextResponse.json(
        { error: 'tokenId, buyerWallet, deadline, signature required' },
        { status: 400 }
      );
    }

    const drop = await getDropByTokenId(parseInt(tokenId));
    if (!drop) {
      return NextResponse.json({ error: 'Drop not found' }, { status: 404 });
    }

    // ── Block mintWithPermit for brand-owned drops ────────────────────
    // RRG.sol mintWithPermit hard-codes a 70% atomic transfer to
    // drop.creator. For brand-owned drops the off-chain auto-payout
    // settles the brand's negotiated split (typically 97.5%) from
    // platform reserves separately. If on-chain creator is anything
    // other than PLATFORM_WALLET, mintWithPermit causes a 67.5%
    // platform loss per sale (see memory/feedback_register_drop_creator
    // _must_be_platform.md). The safe path for brand purchases is
    // direct USDC transfer + operatorMint via /api/rrg/claim, which
    // routes 100% to platform on-chain and lets auto-payout settle the
    // brand share off-chain — proven correct on the 5 membership sales.
    if (drop.is_brand_product) {
      return NextResponse.json(
        {
          error: 'Brand-owned drops do not accept gasless permit purchases. Send USDC directly to the platform wallet and submit the tx via /api/rrg/claim, or use the card / direct-transfer flow on the storefront.',
          code:  'BRAND_PRODUCT_PERMIT_DISABLED',
        },
        { status: 409 },
      );
    }

    // ── Validate shipping for physical products (BEFORE on-chain mint) ──
    // Must validate before mintWithPermit — the on-chain tx is irreversible.
    if (drop.is_physical_product) {
      if (!shipping_name || !shipping_address_line1 || !shipping_city || !shipping_postal_code || !shipping_country || !shipping_phone) {
        return NextResponse.json(
          { error: 'Shipping address and phone required for physical products' },
          { status: 400 }
        );
      }
      if (!buyerEmail) {
        return NextResponse.json(
          { error: 'buyerEmail is required for physical products so the buyer receives their order confirmation' },
          { status: 400 }
        );
      }
      if (!physical_terms_accepted) {
        return NextResponse.json(
          { error: 'Physical product delivery terms must be accepted' },
          { status: 400 }
        );
      }
    }

    // ── Split signature ────────────────────────────────────────────────
    const { v, r, s } = splitSignature(signature);

    // ── Submit mintWithPermit ──────────────────────────────────────────
    const contract = getRRGContract();

    let tx: Awaited<ReturnType<typeof contract.mintWithPermit>>;
    try {
      tx = await contract.mintWithPermit(
        tokenId,
        buyerWallet,
        BigInt(deadline),
        v, r, s
      );
    } catch (contractErr: unknown) {
      const msg = String(contractErr);
      if (msg.includes('sold out'))     return NextResponse.json({ error: 'This drop is sold out.' }, { status: 409 });
      if (msg.includes('not active'))   return NextResponse.json({ error: 'This drop is not active.' }, { status: 409 });
      if (msg.includes('permit'))       return NextResponse.json({ error: 'Permit signature invalid or expired.' }, { status: 400 });
      throw contractErr;
    }

    const receipt   = await tx.wait(1);
    const txHash    = receipt.hash;
    const mintNonce = (tx as { nonce: number }).nonce;

    // ── Resolve effective price (per-variant override if applicable) ──
    const effectivePrice = await resolveEffectivePrice(
      drop.id,
      drop.price_usdc,
      selected_size,
      selected_color,
    );

    // ── Generate download token ────────────────────────────────────────
    const downloadToken   = randomBytes(32).toString('hex');
    const downloadExpiry  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // ── Insert purchase record ─────────────────────────────────────────
    const { data: purchase, error: dbError } = await db
      .from('rrg_purchases')
      .insert({
        submission_id:      drop.id,
        token_id:           parseInt(tokenId),
        buyer_wallet:       buyerWallet.toLowerCase(),
        buyer_email:        buyerEmail || null,
        buyer_type:         'human',
        tx_hash:            txHash,
        amount_usdc:        effectivePrice.toString(),
        download_token:     downloadToken,
        download_expires_at: downloadExpiry,
        network:             getCurrentNetwork(),
        brand_id:            drop.brand_id ?? RRG_BRAND_ID,
        // Shipping fields (physical products)
        ...(drop.is_physical_product ? {
          shipping_name:           shipping_name || null,
          shipping_address_line1:  shipping_address_line1 || null,
          shipping_address_line2:  shipping_address_line2 || null,
          shipping_city:           shipping_city || null,
          shipping_state:          shipping_state || null,
          shipping_postal_code:    shipping_postal_code || null,
          shipping_country:        shipping_country || null,
          shipping_phone:          shipping_phone || null,
          physical_terms_accepted: physical_terms_accepted ?? false,
          // Selected live shipping rate (Shopify-backed drops)
          shipping_rate_handle:    shipping_rate_handle   || null,
          shipping_rate_title:     shipping_rate_title    || null,
          shipping_rate_amount:    shipping_rate_amount   ?? null,
          shipping_rate_currency:  shipping_rate_currency || null,
          shipping_rate_code:      shipping_rate_code     || null,
        } : {}),
        // Size / colour variant
        ...(selected_size  ? { selected_size }  : {}),
        ...(selected_color ? { selected_color } : {}),
      })
      .select()
      .single();

    if (dbError) throw dbError;

    // ── Autopost sale (non-blocking) ─────────────────────────────────────
    (async () => {
      try {
        const { count: purchaseCount } = await db
          .from('rrg_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('token_id', parseInt(tokenId));
        const remaining = Math.max(0, (drop.edition_size ?? 10) - (purchaseCount ?? 1));
        const imageUrl = drop.jpeg_storage_path
          ? await getSignedUrl(drop.jpeg_storage_path, 300).catch(() => null)
          : null;
        await autopostSale({
          title:       drop.title,
          tokenId:     parseInt(tokenId),
          buyerWallet: buyerWallet.toLowerCase(),
          remaining,
          creatorBio:  drop.creator_bio ?? null,
          imageUrl,
        });

        // Instagram notification (non-fatal)
        sendInstagramNotification({
          trigger:       'sale',
          title:         drop.title,
          tokenId:       parseInt(tokenId),
          creatorHandle: drop.creator_handle ?? null,
          creatorType:   (drop.creator_type as 'human' | 'agent') ?? 'human',
          briefName:     null,
          brandName:     null,
          buyerType:     'human',
          imageUrl,
        }).catch((err) => console.error('[confirm] instagram notify failed:', err));
      } catch (err) {
        console.error('[confirm] autopost failed:', err);
      }
    })();

    // ── ERC-8004 reputation signals — nonces chained from mintNonce to prevent RPC lag ─
    // mintWithPermit and giveFeedback share the deployer wallet (DEPLOYER_PRIVATE_KEY).
    // Passing mintNonce+N explicitly avoids stale getTransactionCount reads from fresh providers.
    // Anti-gaming: skip buyer signals if buyer is the creator (self-purchase inflates score).
    let reputationTxHash: string | null = null;
    let nextSignalNonce = mintNonce + 1;
    const isCreatorPurchase = buyerWallet.toLowerCase() === drop.creator_wallet?.toLowerCase();
    if (isCreatorPurchase) {
      console.log('[erc8004] skipping reputation signal — creator self-purchase detected');
    } else {
      try {
        // Resolve buyer's ERC-8004 agentId — by registry lookup
        const resolvedBuyerAgentId: bigint | null = await lookupAgentIdByWallet(buyerWallet.toLowerCase());

        if (resolvedBuyerAgentId) {
          // Signal 1: platform attests buyer completed a verified purchase (tag: purchase/rrg)
          reputationTxHash = await postReputationSignal({
            buyerAgentId: resolvedBuyerAgentId,
            buyerWallet:  buyerWallet.toLowerCase(),
            priceUsdc:    effectivePrice.toString(),
            tokenId:      parseInt(tokenId),
            txHash,
            nonce:        nextSignalNonce,
          });
          nextSignalNonce++;
          console.log(`[confirm] ERC-8004 platform→buyer signal posted (agent #${resolvedBuyerAgentId}): ${reputationTxHash?.slice(0, 10)}…`);

          // Signal 2: buyer reputation signal (tag: purchase/buyer)
          const buyerSignalHash = await postBuyerReputationSignal({
            buyerAgentId: resolvedBuyerAgentId,
            buyerWallet:  buyerWallet.toLowerCase(),
            priceUsdc:    effectivePrice.toString(),
            tokenId:      parseInt(tokenId),
            txHash,
            nonce:        nextSignalNonce,
          });
          nextSignalNonce++;
          console.log(`[confirm] ERC-8004 buyer signal posted (agent #${resolvedBuyerAgentId}): ${buyerSignalHash.slice(0, 10)}…`);
        } else {
          console.log('[confirm] Buyer has no ERC-8004 registration — skipping reputation signals');
        }
      } catch (repErr) {
        // Non-fatal — purchase + mint still succeeded
        console.error('[confirm] ERC-8004 reputation signal failed:', repErr);
      }
    }

    // ── ERC-8004 brand sale signal (sequential — nonce chained from buyer signals) ──
    // Attests the brand agent completed a verified sale on RRG (tag: sale/brand).
    // Only fires when the drop belongs to a brand (brand_id set + is_brand_product).
    // Hash is stored on the distribution record (reputation: prefix) after payout.
    let brandSaleSignalHash: string | null = null;
    if (drop.brand_id && drop.is_brand_product) {
      try {
        const brandForSignal = await getBrandById(drop.brand_id);
        if (brandForSignal?.wallet_address) {
          brandSaleSignalHash = await postBrandSaleSignal({
            brandWallet: brandForSignal.wallet_address,
            priceUsdc:   effectivePrice.toString(),
            tokenId:     parseInt(tokenId),
            txHash,
            nonce:       nextSignalNonce,
          });
          nextSignalNonce++;
          if (brandSaleSignalHash) {
            console.log(`[confirm] ERC-8004 brand sale signal posted: ${brandSaleSignalHash.slice(0, 10)}…`);
          }
        }
      } catch (brandSignalErr) {
        console.error('[confirm] ERC-8004 brand sale signal failed:', brandSignalErr);
      }
    }

    // ── Post-mint: IPFS upload (synchronous — CID included in response) ───
    let ipfsResult: { imageCid: string; metadataCid: string; metadataUrl: string } | null = null;
    try {
      ipfsResult = await uploadToIpfsInBackground(drop);
    } catch (err) {
      console.error('[confirm] IPFS upload failed:', err);
    }

    // ── Generate voucher (if drop has one attached) ──────────────────────
    let voucherData: Awaited<ReturnType<typeof formatVoucherForDisplay>> = null;
    if (drop.has_voucher && drop.voucher_template_id) {
      try {
        const voucher = await createVoucher({
          templateId:   drop.voucher_template_id,
          purchaseId:   purchase.id,
          submissionId: drop.id,
          brandId:      drop.brand_id ?? RRG_BRAND_ID,
          buyerWallet:  buyerWallet.toLowerCase(),
        });
        voucherData = await formatVoucherForDisplay(voucher);
        console.log(`[confirm] Voucher generated: ${voucher.code} (expires ${voucher.expires_at})`);
        // Fire ERC-8004 voucher signal (awaited — sequential to avoid nonce collision)
        try {
          await fireVoucherSignal({
            buyerWallet: buyerWallet.toLowerCase(),
            voucherCode: voucher.code,
            brandId:     drop.brand_id ?? RRG_BRAND_ID,
            tokenId:     parseInt(tokenId),
            signalType:  'voucher_issued',
          });
        } catch (sigErr) {
          console.error('[confirm] Voucher signal failed:', sigErr);
        }
      } catch (voucherErr) {
        console.error('[confirm] Voucher generation failed:', voucherErr);
        // Non-fatal — purchase still succeeded
      }
    }

    // ── Record revenue distribution + auto-payout ────────────────────
    // MUST run AFTER all ERC-8004 signals to avoid deployer wallet nonce collisions.
    let distributionId: string | null = null;
    let brandPayoutTxHash: string | null = null;
    try {
      const brandId = drop.brand_id ?? RRG_BRAND_ID;
      const brand   = brandId !== RRG_BRAND_ID ? await getBrandById(brandId) : null;
      const isLegacy = brandId === RRG_BRAND_ID && !drop.is_brand_product;

      const split = calculateSplit({
        totalUsdc:        effectivePrice,
        brandId,
        creatorWallet:    drop.creator_wallet,
        brandWallet:      brand?.wallet_address ?? null,
        isBrandProduct:   drop.is_brand_product ?? false,
        isLegacy,
        brandPctOverride: brand?.brand_pct_override ?? null,
      });

      const payoutResult = await insertDistributionAndPay({
        purchaseId: purchase.id,
        brandId,
        split,
        tokenId:    parseInt(tokenId),
        mintMethod: 'permit', // mintWithPermit fired the on-chain 70/30 split
      });
      distributionId    = payoutResult.distributionId;
      brandPayoutTxHash = payoutResult.brandTxHash;

      // Append ERC-8004 reputation signal hash to distribution notes for audit trail.
      if (distributionId && brandSaleSignalHash) {
        const { data: distRow } = await db
          .from('rrg_distributions')
          .select('notes')
          .eq('id', distributionId)
          .single();
        const updatedNotes = distRow?.notes
          ? `${distRow.notes} | reputation:${brandSaleSignalHash}`
          : `reputation:${brandSaleSignalHash}`;
        await db.from('rrg_distributions')
          .update({ notes: updatedNotes })
          .eq('id', distributionId);
      }

      // Marketing attribution — commission is on platform share only.
      // This covers both organic candidates and referred wallets; there is
      // no separate per-purchase `?ref=` layer.
      firePurchaseAttribution(buyerWallet.toLowerCase(), txHash, split.platformUsdc);
    } catch (distErr) {
      console.error('[confirm] Distribution/payout failed:', distErr);
      // Non-fatal — purchase still succeeded
    }

    // ── Send delivery email ───────────────────────────────────────────
    const siteUrl     = process.env.NEXT_PUBLIC_SITE_URL!;
    const downloadUrl = `${siteUrl}/rrg/download?token=${downloadToken}`;

    // Digital-only purchases get the file-delivery email here.
    // Physical purchases get the branded order email below (with shipping).
    // One email per purchase, never both.
    if (buyerEmail && !drop.is_physical_product) {
      try {
        const digitalImageUrl = drop.jpeg_storage_path
          ? await getSignedUrl(drop.jpeg_storage_path, 604800).catch(() => null)
          : null;
        const digitalBrand = drop.brand_id
          ? await getBrandById(drop.brand_id).catch(() => null)
          : null;
        await sendFileDeliveryEmail({
          to:              buyerEmail,
          title:           drop.title,
          tokenId:         parseInt(tokenId),
          txHash,
          downloadUrl,
          ipfsMetadataUrl: ipfsResult?.metadataUrl ?? null,
          voucher:         voucherData ?? undefined,
          brandName:       digitalBrand?.name ?? null,
          imageUrl:        digitalImageUrl,
          priceUsdc:       parseFloat(effectivePrice.toString()),
        });
        await db
          .from('rrg_purchases')
          .update({ files_delivered: true, delivery_email: buyerEmail })
          .eq('id', purchase.id);
      } catch (emailErr) {
        console.error('[confirm] Delivery email failed:', emailErr);
        // Non-fatal — buyer can still use download link
      }
    }

    // ── Physical product emails (brand + buyer) ─────────────────────────
    if (drop.is_physical_product && shipping_name) {
      try {
        const brandId = drop.brand_id ?? RRG_BRAND_ID;
        const brand   = await getBrandById(brandId);
        const shippingAddress = [
          shipping_address_line1,
          shipping_address_line2,
          [shipping_city, shipping_state, shipping_postal_code].filter(Boolean).join(', '),
          shipping_country,
        ].filter(Boolean).join('\n');

        const priceForEmail    = parseFloat(effectivePrice.toString());
        const brandPctForEmail = brand?.brand_pct_override ?? 97.5;
        const brandRevenueUsdc = Math.round(priceForEmail * (brandPctForEmail / 100) * 100) / 100;
        const emailImageUrl    = drop.jpeg_storage_path
          ? await getSignedUrl(drop.jpeg_storage_path, 604800).catch(() => null)
          : null;

        const emailData = {
          title:               drop.title,
          tokenId:             parseInt(tokenId),
          txHash,
          brandPayoutTxHash,
          buyerEmail:          buyerEmail || null,
          brandContactEmail:   brand?.contact_email ?? '',
          brandName:           brand?.name ?? 'RRG',
          shippingName:        shipping_name,
          shippingAddress,
          shippingPhone:       shipping_phone || null,
          downloadUrl,
          ipfsMetadataUrl:     ipfsResult?.metadataUrl ?? null,
          imageUrl:            emailImageUrl,
          selectedSize:        selected_size  || null,
          selectedColor:       selected_color || null,
          priceUsdc:           priceForEmail,
          brandRevenueUsdc,
        };

        if (brand?.contact_email) {
          await sendPhysicalOrderToBrand(emailData);
          console.log(`[confirm] Physical order email sent to brand: ${brand.contact_email}`);
        }
        if (buyerEmail) {
          await sendPhysicalPurchaseToBuyer(emailData);
          console.log(`[confirm] Physical purchase email sent to buyer: ${buyerEmail}`);
          // Mark files_delivered here too so the branded buyer email is the
          // single source of truth for "buyer was notified".
          await db
            .from('rrg_purchases')
            .update({ files_delivered: true, delivery_email: buyerEmail })
            .eq('id', purchase.id);
        }
      } catch (physEmailErr) {
        console.error('[confirm] Physical product email failed:', physEmailErr);
        // Non-fatal
      }
    }

    return NextResponse.json({
      success:          true,
      txHash,
      tokenId:          parseInt(tokenId),
      reputationTxHash,
      downloadUrl,
      downloadToken,
      ipfsImageCid:     ipfsResult?.imageCid    ?? null,
      ipfsImageUrl:     ipfsResult ? `https://gateway.pinata.cloud/ipfs/${ipfsResult.imageCid}` : null,
      ipfsMetadataCid:  ipfsResult?.metadataCid ?? null,
      ipfsMetadataUrl:  ipfsResult?.metadataUrl ?? null,
      voucher:          voucherData,
    });

  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/rrg/confirm]', err);
    return NextResponse.json(
      { error: `Purchase failed: ${detail}` },
      { status: 500 }
    );
  }
}
