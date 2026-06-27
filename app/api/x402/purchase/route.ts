import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { extractPaymentProof, verifyAndExecutePayment, verifyUsdcTransfer } from '@/lib/app/x402-server';
import { getRRGContract, toUsdc6dp } from '@/lib/app/contract';
import { calculateSplit, PLATFORM_WALLET } from '@/lib/app/splits';
import { insertDistributionAndPay } from '@/lib/app/auto-payout';
import { shouldSkipErc8004 } from '@/lib/app/test-mode';
import { postViaReputationSignal, parseAgentId } from '@/lib/app/via-reputation';
import { lookupAgentIdByWallet } from '@/lib/app/erc8004';
import { insertNotification } from '@/lib/app/notifications';
import { getDigitalFiles, buildDeliverables, type Deliverable } from '@/lib/app/digital-delivery';
import { isVoucherProduct, getVoucherRedemption, fulfilVoucherPurchase } from '@/lib/app/vouchers';
import { sendTicketDeliveryEmail, sendTicketRegisteredEmail } from '@/lib/app/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/x402/purchase
 *
 * Settlement endpoint for the agent-to-agent buy flow. A seller's MCP
 * buy_product records a 'pending' purchase and quotes an x402 payment
 * requirement. The buyer's agent then settles by POSTing ONE of:
 *   { order_ref, x_payment }       : x402 "exact" permit (we pull the USDC), OR
 *   { order_ref, payment_tx_hash } : a raw USDC transfer it already sent to
 *                                    the platform wallet (we verify, not pull).
 * Both are accepted so any buyer agent can settle regardless of whether its
 * wallet can sign an EIP-2612 permit. This route:
 *   1. Loads the pending purchase (idempotent: re-settling returns stored hashes).
 *   2. Verifies payment: executes the permit on-chain, OR attests the transfer
 *      landed on the platform wallet (anti-replay via unique payment_tx_hash).
 *   3. operatorMints the ERC-1155 receipt to the buyer.
 *   4. Fires BOTH ERC-8004 reputation signals (buyer agent + seller agent),
 *      nonces chained off the mint so neither collides on the gas wallet.
 *   5. Pays the seller their 97.5% via auto-payout (platform keeps 2.5%).
 *
 * Steps 3-5 are non-fatal once payment has settled: the buyer's funds are
 * already in, so a mint or signal hiccup is logged but the purchase still
 * records as paid and the seller is still paid out.
 *
 * Mint-on-purchase: listings are discoverable as drafts (no token_id). The
 * on-chain drop is created HERE, at the moment of sale (registerDrop then
 * operatorMint), so we mint only what actually sells. If an on-chain step
 * fails after payment, the order stays 'paid' with a NEEDS_MINT note and the
 * seller is NOT paid out; re-POSTing the order_ref resumes from the mint.
 */

const UNLIMITED_SUPPLY = 10_000; // RRG.sol caps edition size at 1-10000

/**
 * Create the on-chain drop for a draft listing at point of sale and flip it to
 * 'registered'. Claims a global token_id, reserves it on the row with a
 * compare-and-set (so two concurrent settlements can't double-register), then
 * registerDrop with creator = PLATFORM_WALLET (the split invariant; see
 * lib/app/contract.ts). Test-mode sellers skip the chain and record a TEST tx.
 */
async function registerDropAtSale(
  productId: string,
  priceMinor: number,
  maxSupply: number | null,
  skipChain: boolean,
): Promise<number> {
  const { data: tokenIdData, error: tokErr } = await db.rpc('app_next_token_id');
  if (tokErr || tokenIdData == null) throw new Error(`claim token_id failed: ${tokErr?.message ?? 'null'}`);
  const tokenId = Number(tokenIdData);

  const { data: reserved, error: resErr } = await db
    .from('app_seller_products')
    .update({ token_id: tokenId, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .is('token_id', null)
    .neq('on_chain_status', 'registered')
    .select('id')
    .maybeSingle();
  if (resErr) throw new Error(`reserve token_id failed: ${resErr.message}`);
  if (!reserved) {
    // A concurrent settlement won the token; reuse whatever it registered.
    const { data: row } = await db.from('app_seller_products').select('token_id').eq('id', productId).maybeSingle();
    if (row?.token_id != null) return Number(row.token_id);
    throw new Error('token reservation lost with no resolved token_id');
  }

  let txHash: string;
  if (skipChain) {
    txHash = `TEST-registerDrop-${tokenId}`;
  } else {
    const contract = getRRGContract();
    const price6dp = toUsdc6dp(priceMinor / 1_000_000);
    const tx = await (contract.registerDrop as (
      tokenId: bigint, creator: string, price6dp: bigint, maxSupply: bigint,
    ) => Promise<{ wait: (n?: number) => Promise<{ hash: string }> }>)(
      BigInt(tokenId), PLATFORM_WALLET, price6dp, BigInt(maxSupply ?? UNLIMITED_SUPPLY),
    );
    const receipt = await tx.wait(1);
    txHash = receipt.hash;
  }

  await db.from('app_seller_products')
    .update({ on_chain_status: 'registered', on_chain_tx_hash: txHash, updated_at: new Date().toISOString() })
    .eq('id', productId);
  return tokenId;
}

export async function POST(req: NextRequest) {
  let body: { order_ref?: unknown; x_payment?: unknown; payment_tx_hash?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ settled: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const orderRef      = typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
  const xPayment      = typeof body.x_payment === 'string' ? body.x_payment.trim() : '';
  const paymentTxHash = typeof body.payment_tx_hash === 'string' ? body.payment_tx_hash.trim() : '';
  if (!orderRef) return NextResponse.json({ settled: false, error: 'order_ref is required' }, { status: 400 });
  // Note: a payment proof (x_payment / payment_tx_hash) is required only for a
  // fresh settlement; a recovery re-POST of an already-paid order needs just
  // order_ref. That check lives in the non-recovery branch below.

  // ── 1. Load the purchase + its seller + product ──────────────────────
  const { data: purchase, error: loadErr } = await db
    .from('app_purchases')
    .select(`
      id, status, total_usdc, buyer_wallet, buyer_agent_id, qty,
      mint_tx_hash, payout_tx_hash, payment_tx_hash, order_ref, delivery_address,
      product:product_id ( id, title, token_id, price_minor, max_supply ),
      seller:seller_id ( id, slug, name, wallet_address, seller_pct_override, erc8004_agent_id, owner_user_id, contact_email )
    `)
    .eq('order_ref', orderRef)
    .maybeSingle();

  if (loadErr) {
    console.error('[x402/purchase] load failed', loadErr);
    return NextResponse.json({ settled: false, error: 'could not load order' }, { status: 500 });
  }
  if (!purchase) {
    return NextResponse.json({ settled: false, error: `order ${orderRef} not found` }, { status: 404 });
  }

  // Supabase types nested relations as arrays; normalise to single objects.
  const product = Array.isArray(purchase.product) ? purchase.product[0] : purchase.product;
  const seller  = Array.isArray(purchase.seller)  ? purchase.seller[0]  : purchase.seller;
  if (!product || !seller) {
    return NextResponse.json({ settled: false, error: 'order is missing its product or seller link' }, { status: 500 });
  }

  // ── Idempotency: already settled → return stored hashes ──────────────
  if (purchase.status === 'minted' || purchase.status === 'paid_out') {
    return NextResponse.json({
      settled:        true,
      already:        true,
      order_ref:      orderRef,
      status:         purchase.status,
      mint_tx_hash:   purchase.mint_tx_hash,
      payout_tx_hash: purchase.payout_tx_hash,
    });
  }

  const totalUsdc = Number(purchase.total_usdc);
  const tokenId   = product.token_id != null ? Number(product.token_id) : null;
  const buyerWalletRecorded = String(purchase.buyer_wallet).toLowerCase();

  // ── 2. Verify payment, OR resume an already-paid order (recovery) ────
  // A purchase already in 'paid' (payment captured on a prior attempt, but
  // register/mint/payout did not complete) is resumed WITHOUT re-charging:
  // re-POST the order_ref and we pick up at register + mint + payout below.
  const alreadyPaid = purchase.status === 'paid';
  let pay: { verified: boolean; txHash: string | null; buyerWallet: string | null; error: string | null };
  let settledVia: 'permit' | 'transfer' | 'recovery';

  if (alreadyPaid) {
    const storedTx = purchase.payment_tx_hash as string | null;
    if (!storedTx) {
      return NextResponse.json({ settled: false, order_ref: orderRef, error: 'order is marked paid but has no payment_tx_hash to resume from' }, { status: 409 });
    }
    pay = { verified: true, txHash: storedTx, buyerWallet: buyerWalletRecorded, error: null };
    settledVia = 'recovery';
  } else {
    if (!xPayment && !paymentTxHash) {
      return NextResponse.json({ settled: false, error: 'provide either x_payment (x402 permit) or payment_tx_hash (raw USDC transfer)' }, { status: 400 });
    }
    //   a) x_payment       → x402 "exact" permit; we execute it on-chain (pull).
    //   b) payment_tx_hash  → buyer already sent a raw USDC transfer; we attest it.
    if (xPayment) {
      settledVia = 'permit';
      const headers = new Headers();
      headers.set('x-payment', xPayment);
      const proof = extractPaymentProof(headers);
      if (!proof) {
        return NextResponse.json({ settled: false, error: 'x_payment could not be parsed as an x402 payment proof' }, { status: 400 });
      }
      const r = await verifyAndExecutePayment(proof, totalUsdc);
      pay = { verified: r.verified, txHash: r.txHash, buyerWallet: r.buyerWallet, error: r.error };
    } else {
      settledVia = 'transfer';
      // Anti-replay: a given transfer can settle at most one order. The
      // payment_tx_hash column has a unique index as the hard backstop.
      const { data: dupe } = await db
        .from('app_purchases')
        .select('order_ref')
        .ilike('payment_tx_hash', paymentTxHash)
        .neq('id', purchase.id)
        .maybeSingle();
      if (dupe) {
        return NextResponse.json({ settled: false, order_ref: orderRef, error: `payment_tx_hash already used to settle order ${dupe.order_ref}` }, { status: 409 });
      }
      const r = await verifyUsdcTransfer(paymentTxHash, totalUsdc, buyerWalletRecorded);
      pay = { verified: r.verified, txHash: r.txHash, buyerWallet: r.buyerWallet, error: r.error };
    }

    if (!pay.verified || !pay.txHash) {
      return NextResponse.json({ settled: false, order_ref: orderRef, error: pay.error ?? 'payment verification failed' }, { status: 402 });
    }

    // The wallet the buyer paid from must match the wallet on the order.
    if (pay.buyerWallet && pay.buyerWallet.toLowerCase() !== buyerWalletRecorded) {
      console.warn(`[x402/purchase] ${orderRef} payer ${pay.buyerWallet} differs from recorded buyer_wallet ${buyerWalletRecorded}`);
    }

    // Payment is in. From here failures are non-fatal; record paid first.
    await db.from('app_purchases')
      .update({ status: 'paid', payment_tx_hash: pay.txHash, notes: `settled via ${settledVia}; payment tx ${pay.txHash}` })
      .eq('id', purchase.id);
  }

  // Both branches above guarantee a non-null payment tx hash; narrow it here.
  if (!pay.txHash) {
    return NextResponse.json({ settled: false, order_ref: orderRef, error: 'internal: missing payment tx hash after verification' }, { status: 500 });
  }

  // ── 3. Mint at point of sale: registerDrop (if draft) then operatorMint ─
  const skipChain = shouldSkipErc8004(String(seller.contact_email ?? ''));
  let effectiveTokenId = tokenId;
  let mintTxHash: string | null = null;
  let signalBaseNonce: number | null = null;

  // 3a. Register the on-chain drop now if this listing was still a draft.
  if (effectiveTokenId == null) {
    try {
      effectiveTokenId = await registerDropAtSale(
        product.id as string,
        Number(product.price_minor ?? 0),
        product.max_supply != null ? Number(product.max_supply) : null,
        skipChain,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[x402/purchase] ${orderRef} registerDropAtSale failed`, err);
      await db.from('app_purchases')
        .update({ notes: `NEEDS_MINT: register failed (${msg}); payment ${pay.txHash}` })
        .eq('id', purchase.id);
      return NextResponse.json({
        settled: true, order_ref: orderRef, settled_via: settledVia,
        payment_tx_hash: pay.txHash, mint_tx_hash: null, needs_mint: true,
        note: 'Payment settled but on-chain registration failed; re-POST this order_ref to resume. Seller payout is held until mint completes.',
      });
    }
  }

  // 3b. Mint the ERC-1155 receipt to the buyer.
  if (effectiveTokenId != null) {
    if (skipChain) {
      mintTxHash = `TEST-operatorMint-${effectiveTokenId}`;
      await db.from('app_purchases').update({ status: 'minted', mint_tx_hash: mintTxHash }).eq('id', purchase.id);
    } else {
      try {
        const contract = getRRGContract();
        const mintTx   = await (contract.operatorMint as (
          tokenId: number, buyer: string,
        ) => Promise<{ hash: string; nonce: number; wait: (n?: number) => Promise<unknown> }>)(
          effectiveTokenId,
          buyerWalletRecorded,
        );
        signalBaseNonce = mintTx.nonce + 1;
        await mintTx.wait(1);
        mintTxHash = mintTx.hash;
        await db.from('app_purchases')
          .update({ status: 'minted', mint_tx_hash: mintTxHash })
          .eq('id', purchase.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[x402/purchase] ${orderRef} operatorMint failed`, err);
        await db.from('app_purchases')
          .update({ notes: `NEEDS_MINT: operatorMint failed (${msg}); payment ${pay.txHash}; token ${effectiveTokenId}` })
          .eq('id', purchase.id);
        return NextResponse.json({
          settled: true, order_ref: orderRef, settled_via: settledVia,
          payment_tx_hash: pay.txHash, mint_tx_hash: null, needs_mint: true,
          note: 'Payment settled and drop registered, but minting failed; re-POST this order_ref to resume. Seller payout is held until mint completes.',
        });
      }
    }
  }

  // ── 4. Fire BOTH ERC-8004 reputation signals (buyer + seller) ────────
  // Both improve trust scores. Nonces chain off the mint to avoid gas-wallet
  // collisions; a nonce is only consumed when a signal actually fires.
  const reputation: { buyer: string | null; seller: string | null } = { buyer: null, seller: null };
  let nextNonce = signalBaseNonce;

  let   buyerAgentId  = parseAgentId(purchase.buyer_agent_id as string | null);
  const sellerAgentId = parseAgentId(seller.erc8004_agent_id as string | null);

  // The buyer reputation signal must not depend on the buying agent having
  // volunteered its ERC-8004 id in buy_product. When the column is empty,
  // resolve the id on-chain from the wallet that actually paid, then persist
  // it so the order record is complete. lookupAgentIdByWallet returns a
  // positive id for a registered wallet, -1n for "registered but id unknown",
  // and null for unregistered: only a positive id is usable for giveFeedback.
  if (!buyerAgentId) {
    try {
      const resolved = await lookupAgentIdByWallet(buyerWalletRecorded);
      if (resolved && resolved > 0n) {
        buyerAgentId = resolved;
        void db.from('app_purchases')
          .update({ buyer_agent_id: resolved.toString() })
          .eq('id', purchase.id);
        console.log(`[x402/purchase] ${orderRef} resolved buyer agent id ${resolved} from wallet ${buyerWalletRecorded}`);
      } else if (resolved === -1n) {
        // Wallet holds an ERC-8004 identity token but isn't indexed in
        // app_buyers/app_sellers, so its id can't be resolved (the registry has
        // no reverse lookup). Surface the backfill gap instead of silently
        // skipping: stamping erc8004_agent_id on that buyer row fixes it.
        console.warn(`[x402/purchase] ${orderRef} buyer wallet ${buyerWalletRecorded} holds an ERC-8004 identity token but is not indexed in app_buyers/app_sellers; backfill its erc8004_agent_id to enable the buyer reputation signal`);
      }
    } catch (err) {
      console.warn(`[x402/purchase] ${orderRef} buyer agent-id wallet lookup failed`, err);
    }
  }

  // Self-dealing guard: when the buyer pays from the same wallet as the seller,
  // or both sides resolve to the same ERC-8004 identity, the trade is one
  // entity transacting with itself. Fire NO reputation signal. A wallet may
  // legitimately be both a buyer and a seller on the network, but it must not
  // farm its own reputation by buying from itself.
  const sellerPayoutWallet = String(seller.wallet_address ?? '').toLowerCase();
  const selfDeal =
    (sellerPayoutWallet !== '' && buyerWalletRecorded === sellerPayoutWallet) ||
    (buyerAgentId != null && sellerAgentId != null && buyerAgentId === sellerAgentId);

  if (selfDeal || skipChain) {
    console.log(`[x402/purchase] ${orderRef} ${skipChain ? 'test-mode' : 'self-dealing (buyer wallet/identity == seller)'}; skipping both reputation signals`);
  } else {
    if (buyerAgentId) {
      try {
        reputation.buyer = await postViaReputationSignal({
          agentId:  buyerAgentId,
          orderRef,
          txHash:   pay.txHash,
          role:     'buyer',
          nonce:    nextNonce ?? undefined,
        });
        if (nextNonce != null) nextNonce += 1;
      } catch (err) {
        console.error(`[x402/purchase] ${orderRef} buyer reputation signal failed`, err);
      }
    } else {
      console.log(`[x402/purchase] ${orderRef} no buyer agent id, skipping buyer signal`);
    }

    if (sellerAgentId) {
      try {
        reputation.seller = await postViaReputationSignal({
          agentId:  sellerAgentId,
          orderRef,
          txHash:   pay.txHash,
          role:     'seller',
          nonce:    nextNonce ?? undefined,
        });
        if (nextNonce != null) nextNonce += 1;
      } catch (err) {
        console.error(`[x402/purchase] ${orderRef} seller reputation signal failed`, err);
      }
    } else {
      console.log(`[x402/purchase] ${orderRef} seller has no agent id, skipping seller signal`);
    }
  }

  // ── 5. Pay the seller their 97.5% (platform keeps 2.5%) ──────────────
  const split = calculateSplit({
    totalUsdc,
    sellerWallet:      seller.wallet_address as string,
    sellerPctOverride: seller.seller_pct_override as number | null,
  });

  let payout = { distributionId: null as string | null, sellerTxHash: null as string | null };
  if (skipChain) {
    console.log(`[x402/purchase] ${orderRef} test-mode; skipping on-chain payout`);
  } else if (effectiveTokenId != null && mintTxHash) {
    try {
      payout = await insertDistributionAndPay({
        purchaseId: purchase.id,
        sellerId:   seller.id as string,
        split,
        tokenId:    effectiveTokenId,
        mintMethod: 'operator',
      });
    } catch (err) {
      console.error(`[x402/purchase] ${orderRef} auto-payout failed`, err);
    }
  } else {
    // Mint did not complete: hold payout. The order keeps its NEEDS_MINT note
    // (set above) and is resolved by re-POSTing the order_ref.
    console.warn(`[x402/purchase] ${orderRef} mint incomplete (token=${effectiveTokenId}, mint=${mintTxHash}); holding payout for recovery`);
  }

  // Tie the reputation hashes to the purchase record for traceability.
  await db.from('app_purchases')
    .update({
      notes: `x402 settled; payment ${pay.txHash}`
        + (mintTxHash ? `; mint ${mintTxHash}` : '; mint skipped')
        + (reputation.buyer ? `; rep:buyer ${reputation.buyer}` : '')
        + (reputation.seller ? `; rep:seller ${reputation.seller}` : ''),
    })
    .eq('id', purchase.id);

  // ── Digital delivery: sign download links for digital deliverables ───
  // RRG parity (confirm_purchase returns download links). If this product
  // carries digital files, the buyer receives signed URLs in the settlement
  // response. Non-fatal: the sale already settled, so a signing hiccup just
  // omits the links (recoverable via get_download_links on the seller MCP).
  let download: Deliverable[] | null = null;
  let vouchers: string[] | null = null;
  let lumaRegistered = false;
  try {
    const { data: prodMeta } = await db
      .from('app_seller_products')
      .select('kind, metadata')
      .eq('id', product.id)
      .maybeSingle();
    const files = getDigitalFiles(prodMeta?.metadata);
    if (prodMeta?.kind === 'digital' && files.length > 0) {
      download = await buildDeliverables(files);
    }
    // Event passes are fulfilled by registering the buyer on the seller's Luma
    // event (luma_api mode) or, by default / as fallback, by handing them a
    // UNIQUE redemption code from the pool. Both are idempotent on the purchase.
    if (isVoucherProduct(prodMeta?.metadata)) {
      const deliveryAddr = (purchase.delivery_address ?? null) as { email?: string; name?: string } | null;
      const buyerEmail = deliveryAddr?.email?.trim() || null;
      const buyerName  = deliveryAddr?.name?.trim() || null;
      const ful = await fulfilVoucherPurchase({
        sellerId:   seller.id as string,
        productId:  product.id as string,
        purchaseId: purchase.id as string,
        qty:        Number(purchase.qty) || 1,
        metadata:   prodMeta?.metadata,
        buyerEmail,
        buyerName,
      });
      const eventName = String(seller.name ?? 'Your event');
      const tierTitle = String(product.title ?? 'Event pass');
      if (ful.vouchers.length > 0) {
        vouchers = ful.vouchers;
        if (buyerEmail) {
          try {
            await sendTicketDeliveryEmail({
              to: buyerEmail, eventName, tierTitle, codes: ful.vouchers,
              redemption: getVoucherRedemption(prodMeta?.metadata),
              orderRef, priceUsdc: totalUsdc, txHash: pay.txHash,
            });
          } catch (mailErr) {
            console.warn(`[x402/purchase] ${orderRef} ticket email failed (non-fatal)`, mailErr);
          }
        }
      } else if (ful.lumaRegistered) {
        lumaRegistered = true;
        if (buyerEmail) {
          try {
            await sendTicketRegisteredEmail({ to: buyerEmail, eventName, tierTitle, orderRef, priceUsdc: totalUsdc, txHash: pay.txHash });
          } catch (mailErr) {
            console.warn(`[x402/purchase] ${orderRef} registration email failed (non-fatal)`, mailErr);
          }
        }
      } else {
        console.warn(`[x402/purchase] ${orderRef} voucher fulfilment owed (no code in pool and Luma unavailable) for product ${product.id}`);
      }
    }
  } catch (err) {
    console.warn(`[x402/purchase] ${orderRef} delivery (download/voucher) failed (non-fatal)`, err);
  }

  void insertNotification({
    ownerUserId: seller.owner_user_id as string,
    kind:        'sale',
    title:       `${orderRef}: payment cleared`,
    body:        `${purchase.qty}× ${product.title} · ${totalUsdc.toFixed(2)} USDC settled · your ${split.sellerUsdc.toFixed(2)} USDC payout is on its way.`,
    link:        `/seller/${seller.slug}/admin/orders/${orderRef}`,
    metadata:    {
      order_ref:       orderRef,
      payment_tx_hash: pay.txHash,
      mint_tx_hash:    mintTxHash,
      payout_tx_hash:  payout.sellerTxHash,
      seller_id:       seller.id,
    },
  });

  return NextResponse.json({
    settled:         true,
    order_ref:       orderRef,
    settled_via:     settledVia,
    payment_tx_hash: pay.txHash,
    mint_tx_hash:    mintTxHash,
    seller_usdc:     split.sellerUsdc,
    platform_usdc:   split.platformUsdc,
    payout:          { distribution_id: payout.distributionId, seller_tx_hash: payout.sellerTxHash },
    reputation,
    ...(download ? { download } : {}),
    ...(vouchers ? { vouchers } : {}),
    ...(lumaRegistered ? { luma_registered: true } : {}),
  });
}
