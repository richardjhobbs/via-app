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
import { addLumaGuest } from './luma';

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
 * Buyer-facing support address for a pass (the "email us for more info" line on
 * the receipt). Set per event via metadata.support_email; distinct from the
 * store's account contact so the buyer writes to the organiser, not the owner.
 * Null when unset, so callers can fall back to the store contact.
 */
export function getSupportEmail(metadata: unknown): string | null {
  const m = metadata as Record<string, unknown> | null | undefined;
  const e = m?.support_email;
  return typeof e === 'string' && e.trim() ? e.trim() : null;
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

/* ──────────────────────────────────────────────────────────────────────────
   Fulfilment: how a settled pass purchase is delivered. Two modes, chosen per
   product via metadata.fulfilment.mode:
     - 'code_pool' (default): hand the buyer a unique code from app_voucher_codes.
     - 'luma_api': register the buyer directly on the seller's Luma event, so
       Luma issues the pass; no code for the buyer to redeem.
   luma_api ALWAYS falls back to the code pool when the Luma key/event/email is
   missing or the Luma call fails, so a sale never silently drops.
   ────────────────────────────────────────────────────────────────────────── */

export type FulfilmentMode = 'code_pool' | 'luma_api' | 'manual';

export interface FulfilmentConfig {
  mode:            FulfilmentMode;
  lumaEventApiId?: string;
  /** env var name holding the Luma API key; the key itself is never in the DB. */
  lumaApiKeyEnv:   string;
}

/** Read the fulfilment config off a product's metadata (defaults to code_pool). */
export function getFulfilment(metadata: unknown): FulfilmentConfig {
  const m = metadata as Record<string, unknown> | null | undefined;
  const f = (m?.fulfilment ?? null) as Record<string, unknown> | null;
  if (f && f.mode === 'luma_api') {
    return {
      mode:            'luma_api',
      lumaEventApiId:  typeof f.luma_event_api_id === 'string' ? f.luma_event_api_id : undefined,
      lumaApiKeyEnv:   typeof f.luma_api_key_env === 'string' && f.luma_api_key_env ? f.luma_api_key_env : 'LUMA_API_KEY',
    };
  }
  // Manual issuance: no code pool, no Luma API. The account admins receive the
  // order (buyer name, email, country) and register the attendee themselves;
  // the buyer gets a payment receipt, not a redemption code.
  if (f && f.mode === 'manual') {
    return { mode: 'manual', lumaApiKeyEnv: 'LUMA_API_KEY' };
  }
  return { mode: 'code_pool', lumaApiKeyEnv: 'LUMA_API_KEY' };
}

export interface FulfilmentResult {
  /** mode actually used (luma_api downgrades to code_pool on fallback). */
  mode:           FulfilmentMode;
  /** codes delivered (code_pool path); empty when registered via Luma. */
  vouchers:       string[];
  /** true when the buyer was registered on the Luma event. */
  lumaRegistered: boolean;
  /** true when neither path delivered (pool empty AND luma unavailable). */
  owed:           boolean;
}

/**
 * Fulfil a settled voucher-product purchase. Tries Luma registration when the
 * product is configured for it and the key/event/email are present; otherwise
 * (or on any Luma failure) claims a unique code from the pool. Idempotent via
 * claimVouchersForPurchase for the code path; Luma add-guest is idempotent on
 * email per event.
 */
export async function fulfilVoucherPurchase(params: {
  sellerId:   string;
  productId:  string;
  purchaseId: string;
  qty:        number;
  metadata:   unknown;
  buyerEmail?: string | null;
  buyerName?:  string | null;
}): Promise<FulfilmentResult> {
  const { productId, purchaseId, qty, metadata, buyerEmail, buyerName } = params;
  const cfg = getFulfilment(metadata);

  // Manual issuance never touches the code pool: admins fulfil off the order.
  if (cfg.mode === 'manual') {
    return { mode: 'manual', vouchers: [], lumaRegistered: false, owed: false };
  }

  if (cfg.mode === 'luma_api') {
    const apiKey = cfg.lumaApiKeyEnv ? process.env[cfg.lumaApiKeyEnv] : undefined;
    if (apiKey && cfg.lumaEventApiId && buyerEmail) {
      const r = await addLumaGuest({ apiKey, eventApiId: cfg.lumaEventApiId, email: buyerEmail, name: buyerName });
      if (r.ok) return { mode: 'luma_api', vouchers: [], lumaRegistered: true, owed: false };
      console.warn(`[fulfilment] luma_api failed for purchase ${purchaseId}; falling back to code pool: ${r.error}`);
    } else {
      const why = !apiKey ? 'API key env unset' : !cfg.lumaEventApiId ? 'event id missing' : 'buyer email missing';
      console.warn(`[fulfilment] luma_api configured but ${why}; falling back to code pool for purchase ${purchaseId}`);
    }
  }

  const codes = await claimVouchersForPurchase(productId, purchaseId, qty);
  if (codes.length > 0) return { mode: 'code_pool', vouchers: codes, lumaRegistered: false, owed: false };
  return { mode: cfg.mode, vouchers: [], lumaRegistered: false, owed: true };
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
