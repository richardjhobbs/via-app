/**
 * Free event-pass channel: claim a place on an event's guest list.
 *
 * A "guest_list" tier is a catalogue product (one pass tier) whose metadata
 * carries `fulfilment.mode = 'guest_list'` and `price_minor = 0`. Unlike the
 * paid ticketing path (lib/app/vouchers.ts), there is NO x402 settlement, NO
 * payout, NO mint, and NO redemption code: the pass is simply a confirmed place
 * on app_event_guests that the organiser admits people from (and can export to
 * their own free Luma if they want Luma to run door check-in).
 *
 * This is the single primitive behind both entry points:
 *   - the per-seller MCP `claim_pass` tool (any agent, no signup), and
 *   - the web funnel, where a human creates a Buying Agent and the pass is bound
 *     to that buyer account (app/api/events/[slug]/claim).
 *
 * One pass per email / per buyer account, enforced atomically in
 * app_claim_event_seat (migration 0032) with the unique indexes as the backstop.
 */
import { db } from './db';
import { sendEventGuestEmail } from './email';
import { insertNotification } from './notifications';

/** True when this product is a free guest-list pass tier (not a paid voucher). */
export function isGuestListProduct(metadata: unknown): boolean {
  const m = metadata as Record<string, unknown> | null | undefined;
  const f = m?.fulfilment as Record<string, unknown> | null | undefined;
  return f?.mode === 'guest_list';
}

/** Door / check-in guidance shown to the guest, read off product metadata. */
export interface EventRedemption {
  platform?:     string;
  instructions?: string;
  url?:          string;
}

/** Read the redemption block off a product's metadata, if present. */
export function getEventRedemption(metadata: unknown): EventRedemption | null {
  const m = metadata as Record<string, unknown> | null | undefined;
  const r = m?.redemption;
  return r && typeof r === 'object' ? (r as EventRedemption) : null;
}

export type ClaimOutcome = 'confirmed' | 'already' | 'sold_out' | 'not_available' | 'error';

export interface ClaimEventPassParams {
  sellerId:      string;
  productId:     string;
  name:          string;
  email:         string;
  buyerId?:      string | null;
  buyerWallet?:  string | null;
  buyerAgentId?: string | null;
  source:        'web_signup' | 'mcp_agent';
}

export interface ClaimEventPassResult {
  outcome:    ClaimOutcome;
  guestId?:   string;
  eventName?: string;
  tierTitle?: string;
  error?:     string;
}

/**
 * Claim a free pass. Validates the tier is an active guest_list product, then
 * does the dedupe + allocation decrement + insert atomically via the RPC. On a
 * fresh claim it emails the guest a confirmation and notifies the organiser
 * (both non-fatal: the place is already recorded). Idempotent: a repeat with the
 * same email / buyer account returns 'already' and consumes no second seat.
 */
export async function claimEventPass(p: ClaimEventPassParams): Promise<ClaimEventPassResult> {
  const email = p.email.trim().toLowerCase();
  const name  = p.name.trim();
  if (!email || !email.includes('@')) return { outcome: 'error', error: 'a valid email is required' };
  if (!name)                          return { outcome: 'error', error: 'a name is required' };

  // Load the tier and confirm it is a free guest-list pass on this seller.
  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .select('id, title, active, admin_removed, metadata, seller_id')
    .eq('id', p.productId)
    .eq('seller_id', p.sellerId)
    .maybeSingle();
  if (prodErr || !product || product.admin_removed || !product.active) {
    return { outcome: 'not_available', error: 'pass tier not found or not available' };
  }
  if (!isGuestListProduct(product.metadata)) {
    return { outcome: 'not_available', error: 'this product is not a free guest-list pass' };
  }

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, name, slug, owner_user_id, active')
    .eq('id', p.sellerId)
    .maybeSingle();
  if (!seller || !seller.active) return { outcome: 'not_available', error: 'event not found or not active' };

  const eventName = String(seller.name ?? 'this event');
  const tierTitle = String(product.title ?? 'Event pass');

  const { data, error } = await db.rpc('app_claim_event_seat', {
    p_product_id:     p.productId,
    p_seller_id:      p.sellerId,
    p_email:          email,
    p_name:           name,
    p_buyer_id:       p.buyerId ?? null,
    p_buyer_wallet:   p.buyerWallet ?? null,
    p_buyer_agent_id: p.buyerAgentId ?? null,
    p_source:         p.source,
  });
  if (error) {
    console.error('[event-passes] claim seat failed:', error);
    return { outcome: 'error', eventName, tierTitle, error: 'could not record your place' };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const outcome = (row?.outcome ?? 'error') as ClaimOutcome;
  const guestId = (row?.guest_id ?? undefined) as string | undefined;

  if (outcome === 'confirmed') {
    // Fire-and-forget side effects: the place is already recorded.
    try {
      await sendEventGuestEmail({ to: email, guestName: name, eventName, tierTitle, redemption: getEventRedemption(product.metadata) });
    } catch (mailErr) {
      console.warn('[event-passes] guest email failed (non-fatal):', mailErr);
    }
    void insertNotification({
      ownerUserId: seller.owner_user_id as string,
      kind:        'sale',
      title:       `New guest: ${tierTitle}`,
      body:        `${name} (${email}) claimed a free pass for ${eventName} via ${p.source === 'web_signup' ? 'the signup funnel' : 'an agent'}.`,
      link:        `/seller/${seller.slug}/admin/guests`,
      metadata:    { guest_id: guestId, product_id: p.productId, seller_id: seller.id, source: p.source },
    });
  }

  return { outcome, guestId, eventName, tierTitle };
}
