/**
 * Buyer-agent fulfilment: turn a discovered match into a completed, on-chain
 * settled purchase, autonomously. This is the wire between DISCOVER and SETTLE
 * that closes the agent loop:
 *
 *   match (seller_slug + product_id + price)
 *     -> create order via the seller's checkout path (same validation as buy_product)
 *     -> sign an EIP-2612 USDC permit (platform agent wallet)
 *     -> POST /api/x402/purchase  (pull USDC, mint ERC-1155 receipt, pay seller 97.5%, ERC-8004 reputation)
 *
 * WHO PAYS: the platform agent wallet (DEPLOYER_PRIVATE_KEY) signs the permit,
 * so today this is "VIA's buying agent settles on the buyer's behalf". The
 * server cannot sign from an end user's own embedded wallet, so per-user
 * autonomous settlement from the user's own funds is a later build. The permit
 * domain MUST match the settlement verifier in lib/app/x402-server.ts
 * (USD Coin / version 2) or signature recovery fails.
 *
 * GUARDRAILS: an absolute platform spend cap (ABSOLUTE_MAX_USD) bounds the blast
 * radius regardless of data, then the buyer's own delegation caps decide
 * auto-settle vs owner-confirm. Nothing settles above auto_buy_under_usd without
 * an explicit owner confirmation (opts.confirmedByOwner).
 */

import { ethers } from 'ethers';
import { db } from './db';
import { signX402Permit, type X402PaymentOption } from './x402-client';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_NETWORK = 'eip155:8453';

// Absolute backstop on autonomous spend from the platform agent wallet, beyond
// the buyer's own delegation caps. A bug or bad price data can never pull more
// than this in a single settlement. Override with BUYER_AGENT_MAX_PURCHASE_USD.
const ABSOLUTE_MAX_USD = Number(process.env.BUYER_AGENT_MAX_PURCHASE_USD ?? '5');

interface DelegationCaps {
  max_purchase_usd?: number | null;
  auto_buy_under_usd?: number | null;
  categories_allowed?: string[] | null;
  categories_blocked?: string[] | null;
}

export type FulfilResult =
  | { status: 'settled'; order_ref: string; amount_usdc: number; payment_tx_hash: string | null; mint_tx_hash: string | null; seller_usdc: number | null; reputation: { buyer: string | null; seller: string | null } | null; title: string; seller_name: string }
  | { status: 'needs_confirmation'; match_id: string; title: string; seller_name: string; amount_usdc: number }
  | { status: 'rejected'; reason: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string; order_ref?: string };

interface MatchRow {
  id: string; buyer_id: string; product_id: string; seller_slug: string | null;
  seller_name: string | null; title: string; price_usdc: number | null; source: string;
}

/**
 * Fulfil one discovered match for a buyer. Pure server logic; the caller
 * (owner-authed route, or an agent tool) decides when confirmedByOwner is set.
 */
export async function fulfilMatchById(
  buyerId: string,
  matchId: string,
  opts: { confirmedByOwner?: boolean } = {},
): Promise<FulfilResult> {
  // 1. Load the match, scoped to this buyer.
  const { data: m } = await db
    .from('app_buyer_intent_matches')
    .select('id, buyer_id, product_id, seller_slug, seller_name, title, price_usdc, source')
    .eq('id', matchId)
    .eq('buyer_id', buyerId)
    .maybeSingle();
  if (!m) return { status: 'error', message: 'match not found' };
  const match = m as MatchRow;

  if (match.source !== 'via') {
    return { status: 'unsupported', reason: `In-app settlement currently supports VIA-network products only (this match is from "${match.source}").` };
  }
  if (!match.seller_slug) return { status: 'error', message: 'match has no seller to transact against' };

  const amount = typeof match.price_usdc === 'number' ? match.price_usdc : null;
  if (amount == null || amount <= 0) return { status: 'error', message: 'match has no purchasable price' };

  // 2. Guardrails: absolute platform cap first, then the buyer's delegation caps.
  if (amount > ABSOLUTE_MAX_USD) {
    return { status: 'rejected', reason: `$${amount} exceeds the platform agent spend cap of $${ABSOLUTE_MAX_USD}.` };
  }
  const { data: buyer } = await db.from('app_buyers').select('delegation_caps').eq('id', buyerId).maybeSingle();
  const caps = (buyer?.delegation_caps ?? {}) as DelegationCaps;
  const maxPurchase  = typeof caps.max_purchase_usd === 'number' ? caps.max_purchase_usd : null;
  const autoBuyUnder = typeof caps.auto_buy_under_usd === 'number' ? caps.auto_buy_under_usd : 0;
  if (maxPurchase != null && amount > maxPurchase) {
    return { status: 'rejected', reason: `$${amount} is above your max purchase cap of $${maxPurchase}.` };
  }
  // Anything not under the auto-buy threshold needs an explicit owner confirm.
  if (amount > autoBuyUnder && !opts.confirmedByOwner) {
    return { status: 'needs_confirmation', match_id: match.id, title: match.title, seller_name: match.seller_name ?? 'seller', amount_usdc: amount };
  }

  // 3. The platform agent wallet signs the payment (no end-user key on the server).
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) return { status: 'error', message: 'payments are not configured (no signer key)' };
  let buyerWallet: string;
  try {
    buyerWallet = new ethers.Wallet(deployerKey).address;
  } catch {
    return { status: 'error', message: 'payments are not configured (invalid signer key)' };
  }

  // 4. Create the order through the seller's own checkout path (identical
  // validation to buy_product). Digital/service products need no delivery block.
  let order: { order_ref: string; total_minor: number; total_usdc: number; usdc_address?: string; platform_wallet: string };
  try {
    const res = await fetch(`${APP_BASE}/api/sellers/${match.seller_slug}/products/${match.product_id}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: 1, buyer_wallet: buyerWallet }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'error', message: (j as { error?: string }).error ?? `could not create order (${res.status})` };
    order = j as typeof order;
  } catch (e) {
    return { status: 'error', message: `order create failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 5. Sign the EIP-2612 permit for the exact total to the platform wallet. The
  // domain is pinned to USD Coin / v2 to match the settlement verifier exactly.
  let xPayment: string;
  try {
    const option: X402PaymentOption = {
      scheme:            'exact',
      network:           BASE_NETWORK,
      amount:            String(order.total_minor),
      asset:             order.usdc_address || USDC_ADDRESS,
      payTo:             order.platform_wallet,
      maxTimeoutSeconds: 300,
      extra:             { name: 'USD Coin', version: '2' },
    };
    const permit = await signX402Permit(deployerKey, option);
    xPayment = Buffer.from(JSON.stringify(permit)).toString('base64');
  } catch (e) {
    return { status: 'error', order_ref: order.order_ref, message: `permit signing failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 6. Settle on-chain: pull USDC, mint the receipt to the buyer, pay the seller
  // 97.5%, fire ERC-8004 reputation for both agents.
  try {
    const res = await fetch(`${APP_BASE}/api/x402/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ref: order.order_ref, x_payment: xPayment }),
    });
    const j = await res.json().catch(() => ({})) as {
      settled?: boolean; error?: string; payment_tx_hash?: string | null; mint_tx_hash?: string | null;
      seller_usdc?: number; reputation?: { buyer: string | null; seller: string | null };
    };
    if (!res.ok || !j.settled) {
      return { status: 'error', order_ref: order.order_ref, message: j.error ?? `settlement failed (${res.status})` };
    }
    return {
      status:          'settled',
      order_ref:       order.order_ref,
      amount_usdc:     order.total_usdc,
      payment_tx_hash: j.payment_tx_hash ?? null,
      mint_tx_hash:    j.mint_tx_hash ?? null,
      seller_usdc:     typeof j.seller_usdc === 'number' ? j.seller_usdc : null,
      reputation:      j.reputation ?? null,
      title:           match.title,
      seller_name:     match.seller_name ?? 'seller',
    };
  } catch (e) {
    return { status: 'error', order_ref: order.order_ref, message: `settlement failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
