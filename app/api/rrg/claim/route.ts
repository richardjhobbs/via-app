import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { db, getBrandById, RRG_BRAND_ID } from '@/lib/rrg/db';
import { sendFileDeliveryEmail, sendPhysicalOrderToBrand, sendPhysicalPurchaseToBuyer } from '@/lib/rrg/email';
import { getSignedUrl } from '@/lib/rrg/storage';
import { uploadToIpfsInBackground } from '@/lib/rrg/ipfs';
import { getRRGContract } from '@/lib/rrg/contract';
import { autopostSale } from '@/lib/rrg/autopost';
import { sendInstagramNotification } from '@/lib/rrg/instagram';
import { postReputationSignal, postBuyerReputationSignal, fireVoucherSignal, lookupAgentIdByWallet } from '@/lib/rrg/erc8004';
import { randomBytes } from 'crypto';
import { calculateSplit } from '@/lib/rrg/splits';
import { resolveEffectivePrice } from '@/lib/rrg/pricing';
import { insertDistributionAndPay } from '@/lib/rrg/auto-payout';
import { createVoucher, formatVoucherForDisplay } from '@/lib/rrg/vouchers';
import { incrementTrust } from '@/lib/rrg/agent-trust';
import { firePurchaseAttribution } from '@/lib/rrg/marketing-attribution';

export const dynamic = 'force-dynamic';

// POST /api/rrg/claim — wallet-to-wallet purchase claim (agent-to-agent)
// Called by agents (e.g. DrHobbs MCP confirm_rrg_purchase tool) after sending
// USDC directly to the platform wallet on Base mainnet.
//
// Body: { txHash, buyerWallet, tokenId, email? }
// Verifies on-chain, mints NFT via operatorMint, records purchase, returns download URL + IPFS details.

const PLATFORM_WALLET = (process.env.RRG_PLATFORM_WALLET || '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed').toLowerCase();
const USDC_CONTRACT   = (process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').toLowerCase();
const BASE_RPC        = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';

const TRANSFER_IFACE = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { txHash: rawTxHash, buyerWallet, tokenId, email,
            buyerAgentId,
            shipping_name, shipping_address_line1, shipping_address_line2,
            shipping_city, shipping_state, shipping_postal_code,
            shipping_country, shipping_phone, physical_terms_accepted,
            shipping_rate_handle, shipping_rate_title, shipping_rate_amount,
            shipping_rate_currency, shipping_rate_code,
            selected_size } = body as {
      txHash?:     string;
      buyerWallet: string;
      tokenId:     number;
      email?:      string;
      buyerAgentId?: number;  // ERC-8004 agent ID of the buyer (e.g. 17666 for DrHobbs)
      shipping_name?: string;
      shipping_address_line1?: string;
      shipping_address_line2?: string;
      shipping_city?: string;
      shipping_state?: string;
      shipping_postal_code?: string;
      shipping_country?: string;
      shipping_phone?: string;
      physical_terms_accepted?: boolean;
      shipping_rate_handle?: string;
      shipping_rate_title?: string;
      shipping_rate_amount?: number;
      shipping_rate_currency?: string;
      shipping_rate_code?: string;
      selected_size?: string;
    };

    // ── Input validation ──────────────────────────────────────────────────
    if (!buyerWallet || !tokenId) {
      return NextResponse.json(
        { error: 'buyerWallet and tokenId are required' },
        { status: 400 }
      );
    }
    if (!/^0x[0-9a-fA-F]{40}$/i.test(buyerWallet)) {
      return NextResponse.json({ error: 'Invalid buyerWallet address' }, { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // ── Operator self-purchase detection ─────────────────────────────────
    // When buyer IS the platform wallet (e.g. DrHobbs buying its own drops),
    // USDC payment verification is skipped — requires admin auth instead.
    const isSelfPurchase = buyerWallet.toLowerCase() === PLATFORM_WALLET;

    if (isSelfPurchase) {
      const adminSecret = req.headers.get('x-admin-secret');
      if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
        return NextResponse.json(
          { error: 'Admin auth required for operator self-purchases' },
          { status: 401 }
        );
      }
    }

    // txHash required for normal purchases, optional for self-purchases
    const txHash = isSelfPurchase && !rawTxHash
      ? `0x${randomBytes(32).toString('hex')}`   // synthetic unique hash
      : rawTxHash;

    if (!txHash) {
      return NextResponse.json({ error: 'txHash is required' }, { status: 400 });
    }
    if (!isSelfPurchase && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json({ error: 'Invalid txHash format' }, { status: 400 });
    }

    // ── Look up the drop ──────────────────────────────────────────────────
    const { data: submission, error: subErr } = await db
      .from('rrg_submissions')
      .select('*')
      .eq('token_id', tokenId)
      .eq('status', 'approved')
      .single();

    if (subErr || !submission) {
      return NextResponse.json({ error: 'Drop not found or not approved' }, { status: 404 });
    }

    // ── Per-wallet purchase limit (configurable per drop via max_per_wallet) ──
    const maxPerWallet: number | null = submission.max_per_wallet ?? null;
    if (maxPerWallet && maxPerWallet > 0) {
      const { count: walletCount } = await db
        .from('rrg_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('token_id', tokenId)
        .eq('buyer_wallet', buyerWallet.toLowerCase());

      if ((walletCount ?? 0) >= maxPerWallet) {
        return NextResponse.json(
          { error: `Purchase limit reached: max ${maxPerWallet} per wallet for this drop` },
          { status: 409 }
        );
      }
    }

    // ── Check txHash not already used ─────────────────────────────────────
    const { data: existing } = await db
      .from('rrg_purchases')
      .select('id')
      .eq('tx_hash', txHash)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'This transaction hash has already been used for a purchase' },
        { status: 409 }
      );
    }

    // ── Resolve effective price (per-size override if applicable) ────────
    const effectivePrice = await resolveEffectivePrice(
      submission.id,
      submission.price_usdc,
      selected_size,
    );

    // ── Verify on-chain (skipped for self-purchases) ─────────────────────
    if (!isSelfPurchase) {
      const provider = new ethers.JsonRpcProvider(BASE_RPC);

      let receipt: ethers.TransactionReceipt | null;
      try {
        receipt = await provider.getTransactionReceipt(txHash);
      } catch {
        return NextResponse.json(
          { error: 'Could not fetch transaction. It may still be pending — wait for confirmation and try again.' },
          { status: 400 }
        );
      }

      if (!receipt) {
        return NextResponse.json(
          { error: 'Transaction not found on Base. Ensure it is confirmed before claiming.' },
          { status: 400 }
        );
      }

      if (receipt.status !== 1) {
        return NextResponse.json({ error: 'Transaction failed on-chain' }, { status: 400 });
      }

      // ── Parse Transfer logs from USDC contract ──────────────────────────
      const expectedAmount = BigInt(Math.round(effectivePrice * 1_000_000));

      let paymentVerified = false;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== USDC_CONTRACT) continue;
        try {
          const parsed = TRANSFER_IFACE.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;
          const from:  string = parsed.args[0];
          const to:    string = parsed.args[1];
          const value: bigint = parsed.args[2];

          if (
            from.toLowerCase()  === buyerWallet.toLowerCase() &&
            to.toLowerCase()    === PLATFORM_WALLET &&
            value               >= expectedAmount
          ) {
            paymentVerified = true;
            break;
          }
        } catch {
          // Not a Transfer event from this log — skip
        }
      }

      if (!paymentVerified) {
        return NextResponse.json(
          {
            error: 'Payment not verified. Ensure you sent the correct USDC amount from your wallet to the platform wallet on Base.',
            expected: {
              to:      PLATFORM_WALLET,
              amount:  expectedAmount.toString(),
              network: 'base',
              usdc:    USDC_CONTRACT,
            },
          },
          { status: 402 }
        );
      }
    } else {
      console.log(`[/api/rrg/claim] Operator self-purchase — skipping USDC verification for token #${tokenId}`);
    }

    // ── Validate shipping for physical products ───────────────────────────
    if (submission.is_physical_product) {
      if (!shipping_name || !shipping_address_line1 || !shipping_city || !shipping_postal_code || !shipping_country || !shipping_phone) {
        return NextResponse.json(
          { error: 'Shipping address and phone required for physical products (shipping_name, shipping_address_line1, shipping_city, shipping_postal_code, shipping_country, shipping_phone)' },
          { status: 400 }
        );
      }
      if (!email) {
        return NextResponse.json(
          { error: 'buyerEmail is required for physical products so the buyer receives their order confirmation' },
          { status: 400 }
        );
      }
    }

    // ── Create purchase record ────────────────────────────────────────────
    const downloadToken  = randomBytes(32).toString('hex');
    const downloadExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const siteUrl        = process.env.NEXT_PUBLIC_SITE_URL!;
    const downloadUrl    = `${siteUrl}/rrg/download?token=${downloadToken}`;

    const { data: purchase, error: insertErr } = await db
      .from('rrg_purchases')
      .insert({
        submission_id:       submission.id,
        token_id:            tokenId,
        buyer_wallet:        buyerWallet.toLowerCase(),
        buyer_type:          'agent',
        tx_hash:             txHash,
        amount_usdc:         effectivePrice.toString(),
        download_token:      downloadToken,
        download_expires_at: downloadExpiry,
        files_delivered:     false,
        mint_status:         'pending',
        brand_id:            submission.brand_id ?? RRG_BRAND_ID,
        ...(email ? { delivery_email: email } : {}),
        // Shipping fields (physical products)
        ...(submission.is_physical_product ? {
          shipping_name:           shipping_name || null,
          shipping_address_line1:  shipping_address_line1 || null,
          shipping_address_line2:  shipping_address_line2 || null,
          shipping_city:           shipping_city || null,
          shipping_state:          shipping_state || null,
          shipping_postal_code:    shipping_postal_code || null,
          shipping_country:        shipping_country || null,
          shipping_phone:          shipping_phone || null,
          physical_terms_accepted: physical_terms_accepted ?? false,
          shipping_rate_handle:    shipping_rate_handle   || null,
          shipping_rate_title:     shipping_rate_title    || null,
          shipping_rate_amount:    shipping_rate_amount   ?? null,
          shipping_rate_currency:  shipping_rate_currency || null,
          shipping_rate_code:      shipping_rate_code     || null,
        } : {}),
        // Size / variant (garment products)
        ...(selected_size ? { selected_size } : {}),
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[/api/rrg/claim] DB insert error:', insertErr);
      return NextResponse.json({ error: 'Database error recording purchase' }, { status: 500 });
    }

    // ── Mint NFT on-chain via operatorMint ────────────────────────────────
    let mintTxHash: string | null = null;
    try {
      const contract    = getRRGContract();
      const mintTx      = await contract.operatorMint(tokenId, buyerWallet);
      const mintReceipt = await mintTx.wait(1);
      mintTxHash = mintReceipt.hash;

      // Update mint_status to 'minted' in DB
      await db
        .from('rrg_purchases')
        .update({ mint_status: 'minted' })
        .eq('tx_hash', txHash);

      console.log(`[/api/rrg/claim] operatorMint OK — token #${tokenId} → ${buyerWallet}, mintTx: ${mintTxHash?.slice(0, 10)}…`);
    } catch (mintErr) {
      // Non-fatal — payment verified, download still works; mint can be retried via admin
      console.error('[/api/rrg/claim] operatorMint failed:', mintErr);
    }

    console.log(`[/api/rrg/claim] Claim OK — token #${tokenId}, buyer: ${buyerWallet}, tx: ${txHash.slice(0, 10)}…`);

    // Marketing attribution moved below — after split calculation (uses platformUsdc)

    // ── ERC-8004 reputation signals (sequential — after mint to avoid nonce collision) ─
    // Both operatorMint and giveFeedback use the same deployer wallet signer.
    // Must be sequential to prevent nonce race conditions.
    // Signal: platform (deployer) gives positive feedback ABOUT the buyer agent.
    // Self-feedback (agentId = platform's own agentId) is blocked by the contract.
    let reputationTxHash: string | null = null;
    try {
      // Resolve buyer's ERC-8004 agentId — from request body, or by registry lookup
      const resolvedBuyerAgentId: bigint | null =
        buyerAgentId ? BigInt(buyerAgentId)
        : await lookupAgentIdByWallet(buyerWallet.toLowerCase());

      if (resolvedBuyerAgentId) {
        // Signal 1: platform attests buyer completed a verified purchase (tag: purchase/rrg)
        reputationTxHash = await postReputationSignal({
          buyerAgentId: resolvedBuyerAgentId,
          buyerWallet:  buyerWallet.toLowerCase(),
          priceUsdc:    effectivePrice.toString(),
          tokenId,
          txHash,
        });
        console.log(`[/api/rrg/claim] ERC-8004 platform→buyer signal posted (agent #${resolvedBuyerAgentId}): ${reputationTxHash?.slice(0, 10)}…`);

        // Signal 2: buyer agent reputation signal (tag: purchase/buyer)
        const buyerSignalHash = await postBuyerReputationSignal({
          buyerAgentId: resolvedBuyerAgentId,
          buyerWallet:  buyerWallet.toLowerCase(),
          priceUsdc:    effectivePrice.toString(),
          tokenId,
          txHash,
        });
        console.log(`[/api/rrg/claim] ERC-8004 buyer signal posted (agent #${resolvedBuyerAgentId}): ${buyerSignalHash.slice(0, 10)}…`);
      } else {
        console.log('[/api/rrg/claim] Buyer has no ERC-8004 registration — skipping reputation signals');
      }
    } catch (repErr) {
      // Non-fatal — purchase + mint still succeeded
      console.error('[/api/rrg/claim] ERC-8004 reputation signal failed:', repErr);
    }

    // ── IPFS upload (synchronous — CID included in response) ─────────────
    let ipfsResult: { imageCid: string; metadataCid: string; metadataUrl: string } | null = null;
    try {
      ipfsResult = await uploadToIpfsInBackground(submission);
    } catch (err) {
      console.error('[/api/rrg/claim] IPFS upload failed:', err);
    }

    // ── Autopost sale (non-blocking) ──────────────────────────────────────
    (async () => {
      try {
        const { count: totalPurchases } = await db
          .from('rrg_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('token_id', tokenId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub         = submission as any;
        const editionSize = (sub.edition_size as number) ?? 10;
        const remaining   = Math.max(0, editionSize - (totalPurchases ?? 1));
        const imageUrl    = sub.jpeg_storage_path
          ? await getSignedUrl(sub.jpeg_storage_path as string, 300).catch(() => null)
          : null;
        await autopostSale({
          title:       sub.title,
          tokenId,
          buyerWallet: buyerWallet.toLowerCase(),
          remaining,
          creatorBio:  (sub.creator_bio as string) ?? null,
          imageUrl,
        });

        // Instagram notification (non-fatal)
        sendInstagramNotification({
          trigger:       'sale',
          title:         sub.title as string,
          tokenId,
          creatorHandle: (sub.creator_handle as string) ?? null,
          creatorType:   (sub.creator_type as 'human' | 'agent') ?? 'human',
          briefName:     null,   // brief not fetched in claim route
          brandName:     null,
          buyerType:     'agent',
          imageUrl,
        }).catch((err) => console.error('[/api/rrg/claim] instagram notify failed:', err));
      } catch (err) {
        console.error('[/api/rrg/claim] autopost failed:', err);
      }
    })();

    // ── Generate voucher (if drop has one attached) ──────────────────────
    let voucherData: Awaited<ReturnType<typeof formatVoucherForDisplay>> = null;
    if (submission.has_voucher && submission.voucher_template_id) {
      try {
        const voucher = await createVoucher({
          templateId:   submission.voucher_template_id,
          purchaseId:   purchase.id,
          submissionId: submission.id,
          brandId:      submission.brand_id ?? RRG_BRAND_ID,
          buyerWallet:  buyerWallet.toLowerCase(),
        });
        voucherData = await formatVoucherForDisplay(voucher);
        console.log(`[claim] Voucher generated: ${voucher.code} (expires ${voucher.expires_at})`);
        // Fire ERC-8004 voucher signal (awaited — sequential to avoid nonce collision)
        try {
          await fireVoucherSignal({
            buyerWallet: buyerWallet.toLowerCase(),
            voucherCode: voucher.code,
            brandId:     submission.brand_id ?? RRG_BRAND_ID,
            tokenId:     Number(tokenId),
            signalType:  'voucher_issued',
          });
        } catch (sigErr) {
          console.error('[claim] Voucher signal failed:', sigErr);
        }
      } catch (voucherErr) {
        console.error('[claim] Voucher generation failed:', voucherErr);
        // Non-fatal
      }
    }

    // ── Record revenue distribution + auto-payout ────────────────────
    // MUST run AFTER all ERC-8004 signals to avoid deployer wallet nonce collisions.
    let brandPayoutTxHash: string | null = null;
    try {
      const brandId = submission.brand_id ?? RRG_BRAND_ID;
      const brand   = brandId !== RRG_BRAND_ID ? await getBrandById(brandId) : null;
      const isLegacy = brandId === RRG_BRAND_ID && !submission.is_brand_product;

      const split = calculateSplit({
        totalUsdc:        effectivePrice,
        brandId,
        creatorWallet:    submission.creator_wallet,
        brandWallet:      brand?.wallet_address ?? null,
        isBrandProduct:   submission.is_brand_product ?? false,
        isLegacy,
        brandPctOverride: brand?.brand_pct_override ?? null,
      });

      const payoutResult = await insertDistributionAndPay({
        purchaseId: purchase.id,
        brandId,
        split,
      });
      brandPayoutTxHash = payoutResult.brandTxHash;

      // Marketing attribution — commission is on platform share only.
      // This covers both organic candidates and referred wallets; there is
      // no separate per-purchase `?ref=` layer.
      firePurchaseAttribution(buyerWallet.toLowerCase(), txHash, split.platformUsdc);
    } catch (distErr) {
      console.error('[claim] Distribution/payout failed:', distErr);
    }

    // ── Send delivery email if provided ───────────────────────────────────
    if (email) {
      try {
        await sendFileDeliveryEmail({
          to:              email,
          title:           submission.title,
          tokenId,
          txHash,
          downloadUrl,
          ipfsMetadataUrl: ipfsResult?.metadataUrl ?? null,
          voucher:         voucherData ?? undefined,
        });
        await db
          .from('rrg_purchases')
          .update({ files_delivered: true })
          .eq('tx_hash', txHash);
      } catch (emailErr) {
        console.error('[/api/rrg/claim] Email delivery error:', emailErr);
        // Non-fatal — download URL still returned in response
      }
    }

    // ── Physical product emails (brand + buyer) ─────────────────────────
    if (submission.is_physical_product && shipping_name) {
      try {
        const brandId = submission.brand_id ?? RRG_BRAND_ID;
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

        const emailData = {
          title:             submission.title,
          tokenId,
          txHash,
          brandPayoutTxHash,
          buyerEmail:        email || null,
          brandContactEmail: brand?.contact_email ?? '',
          brandName:         brand?.name ?? 'RRG',
          shippingName:      shipping_name,
          shippingAddress,
          shippingPhone:     shipping_phone || null,
          shippingType:      submission.shipping_type || null,
          downloadUrl,
          ipfsMetadataUrl:   ipfsResult?.metadataUrl ?? null,
          selectedSize:      selected_size || null,
          priceUsdc:         priceForEmail,
          brandRevenueUsdc,
        };

        if (brand?.contact_email) {
          await sendPhysicalOrderToBrand(emailData);
          console.log(`[claim] Physical order email sent to brand: ${brand.contact_email}`);
        }
        if (email) {
          await sendPhysicalPurchaseToBuyer(emailData);
          console.log(`[claim] Physical purchase email sent to buyer: ${email}`);
        }
      } catch (physEmailErr) {
        console.error('[claim] Physical product email failed:', physEmailErr);
        // Non-fatal
      }
    }

    // ── Update agent trust (agent purchases only) ──────────────────────
    if (submission.brand_id && submission.brand_id !== RRG_BRAND_ID) {
      try {
        await incrementTrust(
          submission.brand_id,
          buyerWallet.toLowerCase(),
          effectivePrice
        );
        console.log(`[claim] Agent trust incremented for brand ${submission.brand_id}`);
      } catch (trustErr) {
        console.error('[claim] Agent trust update failed:', trustErr);
        // Non-fatal
      }
    }

    return NextResponse.json({
      success:          true,
      tokenId,
      txHash,
      mintTxHash,
      reputationTxHash,
      downloadUrl,
      downloadToken,
      status:           mintTxHash ? 'minted' : 'pending_mint',
      ipfsImageCid:     ipfsResult?.imageCid    ?? null,
      ipfsImageUrl:     ipfsResult ? `https://gateway.pinata.cloud/ipfs/${ipfsResult.imageCid}` : null,
      ipfsMetadataCid:  ipfsResult?.metadataCid ?? null,
      ipfsMetadataUrl:  ipfsResult?.metadataUrl ?? null,
      voucher:          voucherData,
      message:          mintTxHash
        ? 'Payment verified and ERC-1155 NFT minted to your wallet. Your artwork is ready to download.'
        : 'Payment verified. Your artwork is ready to download. The ERC-1155 NFT will be minted to your wallet shortly.',
    });

  } catch (err) {
    console.error('[/api/rrg/claim]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
