/**
 * lib/app/limits.ts
 *
 * Per-seller free-tier caps. v1 ships with a single hardcoded cap on
 * the number of on-chain-registered active products ("listed" in
 * seller-facing copy). Drafts and inactive rows do not count, so a
 * seller can stage a larger catalogue and curate which 10 go live.
 *
 * When tiering arrives, replace the constant with a per-seller lookup
 * (e.g. read from app_sellers.tier) and keep this file as the single
 * source of truth for cap arithmetic.
 */

import { db } from './db';

/** Max active + on_chain_status='registered' products per seller on the free tier. */
export const FREE_LISTED_CAP = 10;

/**
 * Count of listed (active + registered) products for a seller. Used by
 * the /publish endpoint to gate further publishes and by the products
 * dashboard to surface the counter.
 */
export async function countListedFor(sellerId: string): Promise<number> {
  const { count, error } = await db
    .from('app_seller_products')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId)
    .eq('active', true)
    .eq('on_chain_status', 'registered');
  if (error) throw new Error(`count listed failed: ${error.message}`);
  return count ?? 0;
}

export function listedCapReachedMessage(current: number): string {
  return `Free-tier cap of ${FREE_LISTED_CAP} listed items reached (${current}/${FREE_LISTED_CAP}). Unpublish or deactivate an existing product first, or contact us to lift the cap.`;
}
