/**
 * In-room exclusive offers: a brand that is a VIA seller member of a room puts
 * one of its products in front of the room first, at a room price, and members
 * buy it inside the room with their existing agent wallet. The offer is a
 * pointer to a real app_seller_products row (the product information the brand
 * maintains with its concierge), plus the room price and terms. Purchase runs
 * through the SAME order + /api/x402/purchase settlement as every other buy;
 * the only differences are the member gate and the room price.
 */
import { db } from '../db';
import { getDigitalFiles } from '../digital-delivery';
import { isVoucherProduct } from '../vouchers';
import { isFounder, type Author } from './rooms';

export interface RoomOffer {
  id:              string;
  room_id:         string;
  product_id:      string;
  seller_slug:     string;
  seller_name:     string;
  title:           string;
  description:     string | null;
  kind:            string;
  image_url:       string | null;
  /** The room price, USDC. */
  price_usdc:      number;
  /** The product's normal list price, USDC, for the "usually X" comparison. */
  list_price_usdc: number;
  terms:           string | null;
  qty_cap:         number | null;
  /** Units settled through this offer. */
  sold:            number;
  remaining:       number | null;
  created_by_ref:  string;
  created_at:      string;
}

interface OfferRow {
  id: string; room_id: string; product_id: string; price_minor: number;
  terms: string | null; qty_cap: number | null; created_by_ref: string; created_at: string;
  product: {
    title: string; description: string | null; kind: string; image_url: string | null;
    price_minor: number; active: boolean; admin_removed: boolean | null;
    on_chain_status: string; stock: number | null;
  } | null;
  seller: { slug: string; name: string; active: boolean; agent_wallet_address: string | null } | null;
}

const SETTLED = ['paid', 'minted', 'paid_out'];

/** Units settled through each of the given offers, from the purchases that carry the offer id. */
async function soldByOffer(offerIds: string[]): Promise<Map<string, number>> {
  const sold = new Map<string, number>();
  if (offerIds.length === 0) return sold;
  const { data } = await db
    .from('app_purchases')
    .select('room_offer_id, qty, status')
    .in('room_offer_id', offerIds)
    .in('status', SETTLED);
  for (const r of (data as Array<{ room_offer_id: string; qty: number | null }> | null) ?? []) {
    sold.set(r.room_offer_id, (sold.get(r.room_offer_id) ?? 0) + (r.qty ?? 1));
  }
  return sold;
}

function project(r: OfferRow, sold: number): RoomOffer {
  return {
    id: r.id,
    room_id: r.room_id,
    product_id: r.product_id,
    seller_slug: r.seller?.slug ?? '',
    seller_name: r.seller?.name ?? r.seller?.slug ?? '',
    title: r.product?.title ?? '',
    description: r.product?.description ?? null,
    kind: r.product?.kind ?? 'digital',
    image_url: r.product?.image_url ?? null,
    price_usdc: r.price_minor / 1_000_000,
    list_price_usdc: (r.product?.price_minor ?? 0) / 1_000_000,
    terms: r.terms,
    qty_cap: r.qty_cap,
    sold,
    remaining: r.qty_cap != null ? Math.max(0, r.qty_cap - sold) : null,
    created_by_ref: r.created_by_ref,
    created_at: r.created_at,
  };
}

const OFFER_SELECT = `
  id, room_id, product_id, price_minor, terms, qty_cap, created_by_ref, created_at,
  product:product_id ( title, description, kind, image_url, price_minor, active, admin_removed, on_chain_status, stock ),
  seller:seller_id ( slug, name, active, agent_wallet_address )
`;

/** The room's active offers, newest first, with their live sold counts. */
export async function listRoomOffers(roomId: string): Promise<RoomOffer[]> {
  const { data } = await db
    .from('app_room_offers')
    .select(OFFER_SELECT)
    .eq('room_id', roomId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  const rows = (data as unknown as OfferRow[]) ?? [];
  const sold = await soldByOffer(rows.map((r) => r.id));
  return rows.map((r) => project(r, sold.get(r.id) ?? 0));
}

export async function getRoomOffer(roomId: string, offerId: string): Promise<RoomOffer | null> {
  const { data } = await db
    .from('app_room_offers')
    .select(OFFER_SELECT)
    .eq('room_id', roomId)
    .eq('id', offerId)
    .eq('status', 'active')
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as OfferRow;
  const sold = await soldByOffer([row.id]);
  return project(row, sold.get(row.id) ?? 0);
}

export type CreateOfferResult =
  | { ok: true; offer: RoomOffer }
  | { ok: false; status: number; error: string };

/**
 * A VIA seller member of the room offers one of ITS products to the room. The
 * product must be purchasable by the same rules as the public checkout (so a
 * member can never be sold something the settlement rail cannot deliver), and
 * one product gets at most one live offer per room.
 */
export async function createRoomOffer(
  roomId: string,
  author: Author,
  input: { product_id: string; price_usd: number; terms?: string | null; qty_cap?: number | null },
): Promise<CreateOfferResult> {
  if (author.member_platform !== 'via' || author.member_type !== 'seller') {
    return { ok: false, status: 403, error: 'only a VIA store member of this room can offer a product' };
  }

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, name, active, agent_wallet_address')
    .eq('slug', author.member_ref)
    .maybeSingle();
  if (!seller || !seller.active || !seller.agent_wallet_address) {
    return { ok: false, status: 409, error: 'this store is not currently transactable on VIA' };
  }

  const { data: product } = await db
    .from('app_seller_products')
    .select('id, title, kind, currency, active, admin_removed, on_chain_status, pricing_mode, metadata')
    .eq('id', input.product_id)
    .eq('seller_id', seller.id)
    .maybeSingle();
  if (!product || product.admin_removed) return { ok: false, status: 404, error: 'product not found in your store' };
  if (!product.active || !['draft', 'registered'].includes(product.on_chain_status as string)) {
    return { ok: false, status: 409, error: 'product is not currently purchasable' };
  }
  if (product.currency !== 'USDC') return { ok: false, status: 400, error: 'only USDC-priced products can be offered' };
  if (product.pricing_mode === 'configurable') {
    return { ok: false, status: 409, error: 'per-order priced products cannot be offered for instant purchase' };
  }
  if (isVoucherProduct(product.metadata)) {
    return { ok: false, status: 409, error: 'event passes cannot be offered in a room yet' };
  }
  if (product.kind === 'digital' && getDigitalFiles(product.metadata).length === 0) {
    return { ok: false, status: 409, error: 'this digital product has no deliverable file attached yet' };
  }

  // Whole cents, same as the human checkout charge.
  const priceMinor = Math.round(input.price_usd * 100) * 10_000;
  if (!Number.isFinite(input.price_usd) || priceMinor <= 0) {
    return { ok: false, status: 400, error: 'a room price above zero is required' };
  }
  const qtyCap = input.qty_cap != null ? Math.floor(input.qty_cap) : null;
  if (qtyCap != null && qtyCap <= 0) return { ok: false, status: 400, error: 'the cap must be at least 1' };

  const { data: existing } = await db
    .from('app_room_offers')
    .select('id')
    .eq('room_id', roomId)
    .eq('product_id', product.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) return { ok: false, status: 409, error: 'this product is already on offer in this room' };

  const { data: inserted, error } = await db
    .from('app_room_offers')
    .insert({
      room_id:             roomId,
      seller_id:           seller.id,
      product_id:          product.id,
      price_minor:         priceMinor,
      terms:               input.terms?.trim() || null,
      qty_cap:             qtyCap,
      created_by_platform: author.member_platform,
      created_by_type:     author.member_type,
      created_by_ref:      author.member_ref,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    console.error('[backroom/offers] insert failed:', error);
    return { ok: false, status: 500, error: 'could not create the offer' };
  }
  const offer = await getRoomOffer(roomId, inserted.id as string);
  if (!offer) return { ok: false, status: 500, error: 'could not create the offer' };
  return { ok: true, offer };
}

/** Withdraw an offer: the member who posted it, or a room founder. */
export async function withdrawRoomOffer(roomId: string, offerId: string, author: Author): Promise<{ ok: boolean; status: number; error?: string }> {
  const { data } = await db
    .from('app_room_offers')
    .select('id, created_by_platform, created_by_type, created_by_ref')
    .eq('room_id', roomId)
    .eq('id', offerId)
    .eq('status', 'active')
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: 'offer not found' };
  const row = data as { created_by_platform: string; created_by_type: string; created_by_ref: string };
  const isCreator = row.created_by_platform === author.member_platform
    && row.created_by_type === author.member_type
    && row.created_by_ref.toLowerCase() === author.member_ref.toLowerCase();
  if (!isCreator && !(await isFounder(roomId, author))) {
    return { ok: false, status: 403, error: 'only the store that posted it or a founder can withdraw an offer' };
  }
  const { error } = await db
    .from('app_room_offers')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', offerId);
  if (error) return { ok: false, status: 500, error: 'could not withdraw the offer' };
  return { ok: true, status: 200 };
}

export interface SellerProductLite { id: string; title: string; kind: string; price_usdc: number; image_url: string | null; }

/**
 * The offerable products of the store a seller member runs, for the offer
 * composer. Mirrors the purchasability rules createRoomOffer enforces, so the
 * picker never shows something the create call would refuse.
 */
export async function listOfferableProducts(sellerSlug: string): Promise<SellerProductLite[]> {
  const { data: seller } = await db.from('app_sellers').select('id').eq('slug', sellerSlug).maybeSingle();
  if (!seller) return [];
  const { data } = await db
    .from('app_seller_products')
    .select('id, title, kind, price_minor, currency, image_url, active, admin_removed, on_chain_status, pricing_mode, metadata')
    .eq('seller_id', (seller as { id: string }).id)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = (data as Array<{
    id: string; title: string; kind: string; price_minor: number; currency: string; image_url: string | null;
    admin_removed: boolean | null; on_chain_status: string; pricing_mode: string | null; metadata: unknown;
  }> | null) ?? [];
  return rows
    .filter((p) => !p.admin_removed
      && ['draft', 'registered'].includes(p.on_chain_status)
      && p.currency === 'USDC'
      && p.pricing_mode !== 'configurable'
      && !isVoucherProduct(p.metadata)
      && !(p.kind === 'digital' && getDigitalFiles(p.metadata).length === 0))
    .map((p) => ({ id: p.id, title: p.title, kind: p.kind, price_usdc: p.price_minor / 1_000_000, image_url: p.image_url }));
}
