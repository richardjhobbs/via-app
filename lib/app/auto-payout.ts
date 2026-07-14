/**
 * Auto-payout: inserts a distribution record and immediately pays the
 * seller their 97.5% USDC share via on-chain ERC-20 transfer from the
 * platform wallet.
 *
 * Called from the per-seller MCP buy_product handler after the buyer's
 * USDC has reached the platform wallet (via operatorMint or mintWithPermit).
 *
 * Non-fatal: if the transfer fails, the distribution row is marked
 * 'failed' with the error in `notes`, but the purchase still succeeds.
 * The seller can re-trigger payout from the dashboard.
 *
 * Guardrail A: for every via-app sale the on-chain drop.creator MUST be
 * PLATFORM_WALLET (so on-chain mintWithPermit's 70/30 sends 100% to
 * platform — see splits.ts comment for why). If on-chain creator drifted
 * AND the buyer paid via permit, paying the seller off-chain would
 * compound the loss; this function aborts in that case. For operator/x402
 * paths the buyer's USDC went straight to platform reserves, so a
 * creator mismatch is benign — we warn but proceed.
 */

import { db } from '@/lib/app/db';
import { transferUsdc, getRRGReadOnly } from '@/lib/app/contract';
import { type SplitResult, type SplitRecipient, PLATFORM_WALLET } from '@/lib/app/splits';

export interface AutoPayoutInput {
  purchaseId: string;
  sellerId: string;
  split: SplitResult;
  /** On-chain tokenId of the listing being paid out — used by Guardrail A. */
  tokenId: number;
  /**
   * How the buyer's USDC reached the platform wallet.
   *   'permit'   — mintWithPermit fired on-chain. If on-chain creator is
   *                wrong, off-chain payout compounds the loss; abort.
   *   'operator' — operatorMint after x402 / direct USDC transfer.
   *                On-chain creator is irrelevant; warn but proceed.
   * Defaults to 'operator' (the safe default).
   */
  mintMethod?: 'permit' | 'operator';
  /**
   * The contract the token's drop lives on, for the Guardrail A getDrop read.
   * Defaults to the legacy contract when unset (every pre-cutover token).
   */
  contractAddress?: string;
}

export interface AutoPayoutResult {
  distributionId: string | null;
  sellerTxHash: string | null;
}

export async function insertDistributionAndPay(
  input: AutoPayoutInput,
): Promise<AutoPayoutResult> {
  const { purchaseId, sellerId, split, tokenId, mintMethod = 'operator', contractAddress } = input;
  const result: AutoPayoutResult = { distributionId: null, sellerTxHash: null };

  // ── 1. Insert distribution row as 'pending' ─────────────────────────
  const { data: dist, error: insertErr } = await db
    .from('app_distributions')
    .insert({
      purchase_id:   purchaseId,
      seller_id:     sellerId,
      total_usdc:    split.totalUsdc,
      seller_usdc:   split.sellerUsdc,
      platform_usdc: split.platformUsdc,
      split_type:    split.splitType,
      status:        'pending',
    })
    .select('id')
    .single();

  if (insertErr || !dist) {
    console.error('[auto-payout] distribution insert failed:', insertErr);
    return result;
  }
  result.distributionId = dist.id;

  // ── 2. Guardrail A: on-chain creator invariant ──────────────────────
  try {
    const onChain = await getRRGReadOnly(contractAddress).getDrop(tokenId);
    const onChainCreator = String(onChain.creator).toLowerCase();
    const expected       = PLATFORM_WALLET.toLowerCase();
    if (onChainCreator !== expected) {
      const note = `on-chain creator mismatch: got ${onChain.creator} expected ${PLATFORM_WALLET} (mintMethod=${mintMethod})`;
      if (mintMethod === 'permit') {
        console.error(`[auto-payout] ${dist.id} ABORTED — ${note}`);
        await db.from('app_distributions')
          .update({ status: 'failed', notes: `Guardrail A abort: ${note}` })
          .eq('id', dist.id);
        return result;
      }
      console.warn(`[auto-payout] ${dist.id} WARNING — ${note} (proceeding: operator path)`);
    }
  } catch (checkErr) {
    const msg = checkErr instanceof Error ? checkErr.message : String(checkErr);
    if (mintMethod === 'permit') {
      console.error(`[auto-payout] ${dist.id} ABORTED — Guardrail A read failed: ${msg}`);
      await db.from('app_distributions')
        .update({ status: 'failed', notes: `Guardrail A read failed (permit): ${msg.slice(0, 400)}` })
        .eq('id', dist.id);
      return result;
    }
    console.warn(`[auto-payout] ${dist.id} Guardrail A read failed (${mintMethod}, proceeding): ${msg}`);
  }

  // ── Provisional hold ────────────────────────────────────────────────
  // A store that is not yet live (active = false: self-onboarded, awaiting
  // human approval) settles the sale normally — 100% of buyer USDC is already
  // in the platform wallet — but its 97.5% payout is HELD, not released, until
  // approveAgentStore activates the store and releases it. This secures the
  // flat 2.5% network fee on deals sourced from the open NOSTR broadcast.
  const { data: sellerRow } = await db
    .from('app_sellers').select('active').eq('id', sellerId).maybeSingle();
  if (sellerRow && sellerRow.active === false) {
    await db.from('app_distributions')
      .update({ status: 'held', notes: 'payout held: store pending human approval' })
      .eq('id', dist.id);
    console.log(`[auto-payout] ${dist.id} HELD , seller ${sellerId} not yet active; 97.5% retained in platform wallet until approval`);
    return result;
  }

  // ── 3. Pay the seller share ─────────────────────────────────────────
  // A co-creation split pays each locked wallet its leg; a normal sale pays the
  // single seller wallet. Either way the platform's 2.5% stays in the platform
  // wallet (it was never sent out).
  if (split.recipients && split.recipients.length > 0) {
    return payRecipients(dist.id, purchaseId, split.recipients, result);
  }

  try {
    if (split.sellerUsdc <= 0 || !split.sellerWallet) {
      await db.from('app_distributions')
        .update({ status: 'paid', notes: 'No seller share to pay out' })
        .eq('id', dist.id);
      return result;
    }

    const tx = await transferUsdc(split.sellerWallet, split.sellerUsdc);
    result.sellerTxHash = tx.hash;

    await db.from('app_distributions')
      .update({ status: 'paid', seller_tx_hash: tx.hash, notes: null })
      .eq('id', dist.id);

    await db.from('app_purchases')
      .update({ payout_tx_hash: tx.hash, status: 'paid_out' })
      .eq('id', purchaseId);

    console.log(`[auto-payout] ${dist.id} paid seller ${split.sellerWallet} ${split.sellerUsdc} USDC, tx=${tx.hash}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-payout] ${dist.id} transfer failed:`, errMsg);
    await db.from('app_distributions')
      .update({ status: 'failed', notes: `Auto-payout error: ${errMsg.slice(0, 500)}` })
      .eq('id', dist.id);
  }

  return result;
}

/**
 * Pay each leg of a co-creation split. One app_distribution_recipients row per
 * wallet; sequential transfers use incrementing nonces so they never collide.
 * A leg that fails is recorded 'failed' and does not abort the others; the
 * distribution is marked 'paid' only when every leg paid.
 */
async function payRecipients(
  distId: string,
  purchaseId: string,
  recipients: SplitRecipient[],
  result: AutoPayoutResult,
): Promise<AutoPayoutResult> {
  // Pre-insert the legs so a partial failure leaves a full record to retry from.
  const { data: legs } = await db
    .from('app_distribution_recipients')
    .insert(recipients.map((r) => ({ distribution_id: distId, wallet: r.wallet, usdc: r.usdc, role: r.role, status: 'pending' })))
    .select('id, wallet, usdc, role');
  const legRows = (legs as { id: string; wallet: string; usdc: number; role: string }[] | null) ?? [];

  let baseNonce: number | null = null;
  let anyFailed = false;
  let firstHash: string | null = null;

  for (let i = 0; i < legRows.length; i++) {
    const leg = legRows[i];
    if (Number(leg.usdc) <= 0 || !leg.wallet) {
      await db.from('app_distribution_recipients').update({ status: 'paid', tx_hash: null }).eq('id', leg.id);
      continue;
    }
    try {
      const nonce = baseNonce == null ? undefined : baseNonce + i;
      const tx = await transferUsdc(leg.wallet, Number(leg.usdc), nonce);
      if (baseNonce == null) baseNonce = tx.nonce;  // anchor sequential nonces to the first send
      firstHash = firstHash ?? tx.hash;
      await db.from('app_distribution_recipients').update({ status: 'paid', tx_hash: tx.hash }).eq('id', leg.id);
      console.log(`[auto-payout] ${distId} leg ${leg.role} paid ${leg.wallet} ${leg.usdc} USDC tx=${tx.hash}`);
    } catch (err) {
      anyFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auto-payout] ${distId} leg ${leg.wallet} failed:`, msg);
      await db.from('app_distribution_recipients').update({ status: 'failed' }).eq('id', leg.id);
    }
  }

  result.sellerTxHash = firstHash;
  if (anyFailed) {
    await db.from('app_distributions')
      .update({ status: 'failed', notes: 'one or more co-creation legs failed; see app_distribution_recipients' })
      .eq('id', distId);
  } else {
    await db.from('app_distributions')
      .update({ status: 'paid', seller_tx_hash: firstHash, notes: null })
      .eq('id', distId);
    await db.from('app_purchases')
      .update({ payout_tx_hash: firstHash, status: 'paid_out' })
      .eq('id', purchaseId);
  }
  return result;
}

/**
 * Release every HELD distribution for a store, once it is approved (active).
 * Transfers each held 97.5% share to the seller's payout wallet and marks the
 * row 'paid' + its purchase 'paid_out'. Idempotent: acts only on rows still in
 * 'held', so a re-run after a partial failure resumes safely. Called from
 * approveAgentStore; non-fatal there.
 */
export async function releaseHeldDistributions(sellerId: string): Promise<{ released: number; failed: number }> {
  const out = { released: 0, failed: 0 };
  const { data: seller } = await db
    .from('app_sellers').select('wallet_address').eq('id', sellerId).maybeSingle();
  const wallet = String(seller?.wallet_address ?? '');

  const { data: held } = await db
    .from('app_distributions')
    .select('id, purchase_id, seller_usdc')
    .eq('seller_id', sellerId)
    .eq('status', 'held');

  for (const d of held ?? []) {
    const amount = Number(d.seller_usdc);
    try {
      // A co-created product splits the held seller share across its locked
      // wallets; a normal product pays the single seller wallet.
      const recipients = await heldRecipients(d.purchase_id, amount);
      if (recipients) {
        const result: AutoPayoutResult = { distributionId: d.id, sellerTxHash: null };
        const paid = await payRecipients(d.id, d.purchase_id, recipients, result);
        if (paid.sellerTxHash) out.released += 1; else out.failed += 1;
        continue;
      }
      if (amount <= 0 || !wallet) {
        await db.from('app_distributions').update({ status: 'paid', notes: 'released: no seller share' }).eq('id', d.id);
        out.released += 1;
        continue;
      }
      const tx = await transferUsdc(wallet, amount);
      await db.from('app_distributions').update({ status: 'paid', seller_tx_hash: tx.hash, notes: null }).eq('id', d.id);
      await db.from('app_purchases').update({ payout_tx_hash: tx.hash, status: 'paid_out' }).eq('id', d.purchase_id);
      console.log(`[auto-payout] released held ${d.id} -> ${wallet} ${amount} USDC tx=${tx.hash}`);
      out.released += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-payout] release held ${d.id} failed:`, msg);
      await db.from('app_distributions').update({ notes: `release failed: ${msg.slice(0, 400)}` }).eq('id', d.id);
      out.failed += 1;
    }
  }
  return out;
}

/**
 * If the held distribution's product has a locked co-creation split, divide the
 * held seller share across those wallets and return the legs; else null (pay the
 * single seller wallet). The last leg absorbs the rounding remainder so the legs
 * sum exactly to the held amount.
 */
async function heldRecipients(purchaseId: string, sellerUsdc: number): Promise<SplitRecipient[] | null> {
  const { data: purchase } = await db
    .from('app_purchases').select('product_id').eq('id', purchaseId).maybeSingle();
  const productId = (purchase as { product_id: string } | null)?.product_id;
  if (!productId) return null;
  const { data: rows } = await db
    .from('app_product_cocreators').select('payout_wallet, pct, role').eq('product_id', productId);
  const cocreators = (rows as { payout_wallet: string; pct: number; role: string }[] | null) ?? [];
  if (!cocreators.length) return null;

  const round6 = (n: number) => parseFloat(n.toFixed(6));
  const pctTotal = cocreators.reduce((s, c) => s + Number(c.pct), 0);
  const recipients: SplitRecipient[] = [];
  let allocated = 0;
  cocreators.forEach((c, i) => {
    const last = i === cocreators.length - 1;
    const usdc = last ? round6(sellerUsdc - allocated) : round6(sellerUsdc * Number(c.pct) / pctTotal);
    allocated = round6(allocated + usdc);
    recipients.push({ wallet: c.payout_wallet, usdc, role: c.role });
  });
  return recipients;
}
