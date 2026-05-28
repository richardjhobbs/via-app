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
import { type SplitResult, PLATFORM_WALLET } from '@/lib/app/splits';

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
}

export interface AutoPayoutResult {
  distributionId: string | null;
  sellerTxHash: string | null;
}

export async function insertDistributionAndPay(
  input: AutoPayoutInput,
): Promise<AutoPayoutResult> {
  const { purchaseId, sellerId, split, tokenId, mintMethod = 'operator' } = input;
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
    const onChain = await getRRGReadOnly().getDrop(tokenId);
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

  // ── 3. Send the seller's 97.5% share via USDC ERC-20 transfer ──────
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
