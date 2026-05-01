/**
 * Auto-payout: inserts a distribution record and immediately pays out
 * creator/brand shares via on-chain USDC transfer.
 *
 * Called by confirm, claim, and MCP confirm_purchase routes.
 * Non-fatal — if the transfer fails the distribution is marked 'failed'
 * with the error in `notes`, but the purchase still succeeds.
 *
 * Transaction hashes are stored in both rrg_distributions.notes AND
 * rrg_purchases.payout_tx_hashes for dispute resolution.
 */

import { db } from '@/lib/rrg/db';
import { transferUsdc, getPlatformSigner, getRRGReadOnly } from '@/lib/rrg/contract';
import { type SplitResult, getBrandPct, PLATFORM_WALLET } from '@/lib/rrg/splits';

export interface AutoPayoutInput {
  purchaseId: string;
  brandId: string;
  split: SplitResult;
  /**
   * On-chain tokenId of the drop being paid out. Required so the defensive
   * Guardrail A check can verify drop.creator on-chain matches PLATFORM_WALLET
   * for non-legacy split types — a mismatch indicates the registerDrop-creator
   * bug class (post-mortem at memory/feedback_register_drop_creator_must_be_platform.md).
   */
  tokenId: number;
  /**
   * How the buyer's USDC reached the platform.
   *   'permit'   — mintWithPermit (on-chain 70/30 split fired). If on-chain creator
   *                is wrong AND splitType is non-legacy, off-chain payout would
   *                compound the loss; Guardrail A aborts.
   *   'operator' — operatorMint after off-chain USDC transfer (100% to platform).
   *                On-chain creator is irrelevant; check warns but does not abort.
   *   'card'     — Stripe capture in fiat, then operatorMint. Same as 'operator'.
   * Defaults to 'operator' when omitted (the safe default — only the permit path
   * is at risk of compounding loss).
   */
  mintMethod?: 'permit' | 'operator' | 'card';
}

export interface AutoPayoutResult {
  distributionId: string | null;
  creatorTxHash: string | null;
  brandTxHash: string | null;
}

/**
 * Insert a distribution record, execute USDC payouts, and store tx hashes
 * on both the distribution and purchase records.
 */
export async function insertDistributionAndPay(
  input: AutoPayoutInput,
): Promise<AutoPayoutResult> {
  const { purchaseId, brandId, split, tokenId, mintMethod = 'operator' } = input;
  const result: AutoPayoutResult = {
    distributionId: null,
    creatorTxHash: null,
    brandTxHash: null,
  };

  // ── 1. Insert distribution record as 'pending' ──────────────────────
  const { data: dist, error: insertErr } = await db
    .from('rrg_distributions')
    .insert({
      purchase_id:    purchaseId,
      brand_id:       brandId,
      total_usdc:     split.totalUsdc,
      creator_usdc:   split.creatorUsdc,
      brand_usdc:     split.brandUsdc,
      platform_usdc:  split.platformUsdc,
      creator_wallet: split.creatorWallet,
      brand_wallet:   split.brandWallet,
      split_type:     split.splitType,
      status:         'pending',
    })
    .select('id')
    .single();

  if (insertErr || !dist) {
    console.error('[auto-payout] Distribution insert failed:', insertErr);
    return result;
  }

  result.distributionId = dist.id;

  // ── 1b. Write audit columns on the purchase record ─────────────────
  const splitModel = split.splitType === 'brand_product_tiered'
    ? 'tiered_brand'
    : split.splitType === 'legacy_70_30'
    ? 'fixed_legacy'
    : 'fixed_co_created';
  const brandPctApplied = split.splitType === 'brand_product_tiered'
    ? getBrandPct(split.totalUsdc)
    : split.splitType === 'challenge_35_35_30'
    ? 35
    : split.splitType === 'legacy_70_30'
    ? 0
    : split.brandUsdc > 0 ? parseFloat((split.brandUsdc / split.totalUsdc * 100).toFixed(2)) : 0;

  await db.from('rrg_purchases')
    .update({
      split_creator_usdc:  split.creatorUsdc,
      split_brand_usdc:    split.brandUsdc,
      split_platform_usdc: split.platformUsdc,
      brand_pct_applied:   parseFloat(brandPctApplied.toFixed(2)),
      split_model:         splitModel,
    })
    .eq('id', purchaseId);

  // ── 2. Legacy splits: on-chain 70/30, no off-chain payout ───────────
  if (split.splitType === 'legacy_70_30') {
    await db.from('rrg_distributions')
      .update({ status: 'completed', notes: 'Legacy on-chain split — no off-chain payout needed' })
      .eq('id', dist.id);
    return result;
  }

  // ── 2b. Guardrail A: on-chain creator invariant check ──────────────
  // For all non-legacy split types the on-chain `creator` MUST be
  // PLATFORM_WALLET so that mintWithPermit's hard-coded 70/30 sends 100%
  // to platform and this off-chain payout settles the negotiated split.
  // If on-chain creator is anything else AND the buyer paid via permit,
  // the brand/creator already received 70% on-chain — paying again here
  // compounds the loss (see memory/feedback_register_drop_creator_must_be_platform.md).
  // For operator/card paths the buyer's USDC went straight to platform so
  // an on-chain creator mismatch is irrelevant; we warn but proceed.
  try {
    const onChain = await getRRGReadOnly().getDrop(tokenId);
    const onChainCreator = String(onChain.creator).toLowerCase();
    const expected       = PLATFORM_WALLET.toLowerCase();
    if (onChainCreator !== expected) {
      const note = `on-chain creator mismatch: got ${onChain.creator} expected ${PLATFORM_WALLET} (mintMethod=${mintMethod}, splitType=${split.splitType})`;
      if (mintMethod === 'permit') {
        // Permit path: ABORT to prevent compounding the on-chain split loss.
        console.error(`[auto-payout] ${dist.id} ABORTED — ${note}`);
        await db.from('rrg_distributions')
          .update({ status: 'failed', notes: `Guardrail A abort: ${note}` })
          .eq('id', dist.id);
        return result;
      }
      // Operator/card path: warn, continue (no on-chain split happened).
      console.warn(`[auto-payout] ${dist.id} WARNING — ${note} (proceeding: mint method is ${mintMethod}, no on-chain split)`);
    }
  } catch (checkErr) {
    // RPC failure on the read should not silently bypass the safety check
    // for the permit path. For operator/card we proceed but log.
    const msg = checkErr instanceof Error ? checkErr.message : String(checkErr);
    if (mintMethod === 'permit') {
      console.error(`[auto-payout] ${dist.id} ABORTED — Guardrail A read failed: ${msg}`);
      await db.from('rrg_distributions')
        .update({ status: 'failed', notes: `Guardrail A read failed (mintMethod=permit): ${msg.slice(0, 400)}` })
        .eq('id', dist.id);
      return result;
    }
    console.warn(`[auto-payout] ${dist.id} Guardrail A read failed (mintMethod=${mintMethod}, proceeding): ${msg}`);
  }

  // ── 3. Execute USDC transfers ───────────────────────────────────────
  try {
    const signer = getPlatformSigner();
    let nonce = await signer.getNonce('pending');
    const txHashes: string[] = [];

    // Creator payout
    if (split.creatorUsdc > 0 && split.creatorWallet) {
      const tx = await transferUsdc(split.creatorWallet, split.creatorUsdc, nonce);
      result.creatorTxHash = tx.hash;
      txHashes.push(`creator:${tx.hash}`);
      nonce = tx.nonce + 1;
    }

    // Brand payout
    if (split.brandUsdc > 0 && split.brandWallet) {
      const tx = await transferUsdc(split.brandWallet, split.brandUsdc, nonce);
      result.brandTxHash = tx.hash;
      txHashes.push(`brand:${tx.hash}`);
      nonce = tx.nonce + 1;
    }

    // Mark distribution completed with tx hashes
    const notes = txHashes.join(' | ') || 'No transfers needed (platform-only)';
    await db.from('rrg_distributions')
      .update({ status: 'completed', notes })
      .eq('id', dist.id);

    // Store payout tx hashes on the purchase record for dispute resolution
    await db.from('rrg_purchases')
      .update({ payout_tx_hashes: notes })
      .eq('id', purchaseId);

    console.log(`[auto-payout] ${dist.id} completed:`, txHashes.join(', '));

  } catch (err) {
    const errMsg = String(err);
    console.error(`[auto-payout] ${dist.id} transfer failed:`, errMsg);

    await db.from('rrg_distributions')
      .update({ status: 'failed', notes: `Auto-payout error: ${errMsg.slice(0, 500)}` })
      .eq('id', dist.id);
  }

  return result;
}
