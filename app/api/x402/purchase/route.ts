import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { extractPaymentProof, verifyAndExecutePayment, verifyUsdcTransfer } from '@/lib/app/x402-server';
import { getRRGContract } from '@/lib/app/contract';
import { calculateSplit } from '@/lib/app/splits';
import { insertDistributionAndPay } from '@/lib/app/auto-payout';
import { postViaReputationSignal, parseAgentId } from '@/lib/app/via-reputation';
import { lookupAgentIdByWallet } from '@/lib/app/erc8004';
import { insertNotification } from '@/lib/app/notifications';

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
 */
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
  if (!xPayment && !paymentTxHash) {
    return NextResponse.json({ settled: false, error: 'provide either x_payment (x402 permit) or payment_tx_hash (raw USDC transfer)' }, { status: 400 });
  }

  // ── 1. Load the purchase + its seller + product ──────────────────────
  const { data: purchase, error: loadErr } = await db
    .from('app_purchases')
    .select(`
      id, status, total_usdc, buyer_wallet, buyer_agent_id, qty,
      mint_tx_hash, payout_tx_hash, order_ref,
      product:product_id ( id, title, token_id ),
      seller:seller_id ( id, slug, name, wallet_address, seller_pct_override, erc8004_agent_id, owner_user_id )
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

  // ── 2. Verify payment (two accepted methods) ─────────────────────────
  //   a) x_payment       → x402 "exact" permit; we execute it on-chain (pull).
  //   b) payment_tx_hash  → buyer already sent a raw USDC transfer; we only
  //                         attest the on-chain Transfer landed on platform.
  // Sellers accept both so any buyer agent can settle, whether or not its
  // wallet can sign an EIP-2612 permit.
  let pay: { verified: boolean; txHash: string | null; buyerWallet: string | null; error: string | null };
  let settledVia: 'permit' | 'transfer';

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

  // ── 3. operatorMint the ERC-1155 receipt to the buyer ────────────────
  let mintTxHash: string | null = null;
  let signalBaseNonce: number | null = null;
  if (tokenId != null) {
    try {
      const contract = getRRGContract();
      const mintTx   = await (contract.operatorMint as (
        tokenId: number, buyer: string,
      ) => Promise<{ hash: string; nonce: number; wait: (n?: number) => Promise<unknown> }>)(
        tokenId,
        buyerWalletRecorded,
      );
      signalBaseNonce = mintTx.nonce + 1;
      await mintTx.wait(1);
      mintTxHash = mintTx.hash;
      await db.from('app_purchases')
        .update({ status: 'minted', mint_tx_hash: mintTxHash })
        .eq('id', purchase.id);
    } catch (err) {
      console.error(`[x402/purchase] ${orderRef} operatorMint failed`, err);
    }
  } else {
    console.warn(`[x402/purchase] ${orderRef} product has no token_id, skipping mint`);
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
      }
    } catch (err) {
      console.warn(`[x402/purchase] ${orderRef} buyer agent-id wallet lookup failed`, err);
    }
  }

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

  // ── 5. Pay the seller their 97.5% (platform keeps 2.5%) ──────────────
  const split = calculateSplit({
    totalUsdc,
    sellerWallet:      seller.wallet_address as string,
    sellerPctOverride: seller.seller_pct_override as number | null,
  });

  let payout = { distributionId: null as string | null, sellerTxHash: null as string | null };
  if (tokenId != null) {
    try {
      payout = await insertDistributionAndPay({
        purchaseId: purchase.id,
        sellerId:   seller.id as string,
        split,
        tokenId,
        mintMethod: 'operator',
      });
    } catch (err) {
      console.error(`[x402/purchase] ${orderRef} auto-payout failed`, err);
    }
  } else {
    console.warn(`[x402/purchase] ${orderRef} no token_id, skipping auto-payout (manual review)`);
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
  });
}
