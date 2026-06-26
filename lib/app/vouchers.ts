/**
 * Voucher-code pool for the ticketing / event channel.
 *
 * A "voucher product" is a catalogue product (one pass tier) whose metadata
 * carries `voucher: true`. Its redeemable codes live in app_voucher_codes
 * (migration 0031), one row per code. At settlement we claim `qty` codes for the
 * purchase via the app_claim_voucher RPC (atomic, concurrency-safe), and hand
 * them to the buyer through the same delivery channel the digital-file path uses.
 *
 * This is the single net-new primitive ticketing needs over the existing
 * digital-delivery flow, which signs the SAME file for every buyer; a ticket
 * needs a DIFFERENT code per buyer that no one else ever sees.
 */
import { db } from './db';

/** Redemption guidance shown to the buyer with their code(s). */
export interface VoucherRedemption {
  platform?:     string;  // e.g. 'luma'
  instructions?: string;  // human-facing "how to redeem" text
  url?:          string;  // where to redeem
}

/** True when this product's codes come from the voucher pool. */
export function isVoucherProduct(metadata: unknown): boolean {
  const m = metadata as Record<string, unknown> | null | undefined;
  return m?.voucher === true;
}

/** Read the redemption block off a product's metadata, if present. */
export function getVoucherRedemption(metadata: unknown): VoucherRedemption | null {
  const m = metadata as Record<string, unknown> | null | undefined;
  const r = m?.redemption;
  return r && typeof r === 'object' ? (r as VoucherRedemption) : null;
}

/**
 * Claim up to `qty` codes for a purchase, idempotently. Codes already bound to
 * this purchase are returned as-is (so a settlement re-POST / recovery yields
 * the same codes rather than burning new ones); only the shortfall is claimed.
 * Returns fewer than `qty` when the pool runs dry mid-claim.
 */
export async function claimVouchersForPurchase(
  productId: string,
  purchaseId: string,
  qty: number,
): Promise<string[]> {
  const { data: existing, error: exErr } = await db
    .from('app_voucher_codes')
    .select('code')
    .eq('claimed_by_purchase', purchaseId)
    .order('claimed_at', { ascending: true });
  if (exErr) {
    console.error('[vouchers] existing-claim lookup failed:', exErr);
    return [];
  }

  const codes = (existing ?? []).map((r) => r.code as string);
  for (let i = codes.length; i < qty; i++) {
    const { data, error } = await db.rpc('app_claim_voucher', {
      p_product_id: productId,
      p_purchase_id: purchaseId,
    });
    if (error) {
      console.error('[vouchers] claim failed:', error);
      break;
    }
    if (!data) break; // pool empty
    codes.push(data as string);
  }
  return codes.slice(0, qty);
}

/** Remaining unclaimed codes for a product (i.e. the tier's live stock). */
export async function availableVoucherCount(productId: string): Promise<number> {
  const { count, error } = await db
    .from('app_voucher_codes')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId)
    .eq('status', 'available');
  if (error) {
    console.error('[vouchers] available-count failed:', error);
    return 0;
  }
  return count ?? 0;
}

/** Insert a batch of codes into a product's pool. Duplicate (product_id, code)
 *  rows are ignored, so re-uploading an overlapping batch is safe. Returns how
 *  many NEW codes were added. */
export async function addVoucherCodes(
  sellerId: string,
  productId: string,
  rawCodes: string[],
): Promise<number> {
  const seen = new Set<string>();
  const rows = rawCodes
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !seen.has(c) && seen.add(c))
    .map((code) => ({ seller_id: sellerId, product_id: productId, code }));
  if (rows.length === 0) return 0;

  const { data, error } = await db
    .from('app_voucher_codes')
    .upsert(rows, { onConflict: 'product_id,code', ignoreDuplicates: true })
    .select('id');
  if (error) {
    console.error('[vouchers] addVoucherCodes failed:', error);
    throw new Error(`could not add voucher codes: ${error.message}`);
  }
  return data?.length ?? 0;
}
