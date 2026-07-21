/**
 * VIA side of the RRG room-offer federation.
 *
 * An RRG brand member of a Back Room offers one of its RRG drops at a room
 * price. The product data lives on RRG, so the composer catalogue comes over a
 * signed HTTP call (never a SQL union); the purchase is collected on VIA's
 * gasless permit rail into the SHARED platform wallet and then settled on
 * RRG's /api/rrg/claim, with the room price authorized by an HMAC over
 * VIA_PLATFORM_SECRET (the secret both platforms already share). RRG verifies
 * the same USDC transfer the permit produced, mints, delivers, and pays the
 * brand its split of the room price.
 */
import { createHmac } from 'crypto';

const RRG_BASE = (process.env.RRG_SITE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

function hmacHex(message: string): string | null {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** The signed room-price authorization RRG's claim endpoint verifies.
 *  priceMinor is USDC in 6-decimal minor units, integer, matching RRG's side. */
export function roomOfferSig(tokenId: number, buyerWallet: string, priceMinor: number): string | null {
  return hmacHex(`via-room-offer|${tokenId}|${buyerWallet.toLowerCase()}|${Math.floor(priceMinor)}`);
}

export interface RrgCatalogueItem {
  token_id:       number;
  title:          string;
  price_usdc:     number;
  is_physical:    boolean;
  remaining:      number;
  sizes_in_stock: string[];
  image:          string | null;
  page_url:       string;
}

/**
 * The brand's live RRG catalogue for the offer composer. Null on any transport
 * or auth failure, so the caller can distinguish "unreachable" from "empty".
 */
export async function fetchBrandCatalogue(brandSlug: string): Promise<{ brand: string; products: RrgCatalogueItem[] } | null> {
  const body = JSON.stringify({ brand_slug: brandSlug.toLowerCase() });
  const sig = hmacHex(body);
  if (!sig) { console.warn('[rrg-offers] VIA_PLATFORM_SECRET not set; cannot fetch RRG catalogue'); return null; }
  try {
    const res = await fetch(`${RRG_BASE}/api/via/room-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-via-signature': sig },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { brand?: string; products?: RrgCatalogueItem[] };
    if (!Array.isArray(json.products)) return null;
    return { brand: json.brand ?? brandSlug, products: json.products };
  } catch {
    return null;
  }
}

export interface RrgClaimInput {
  tokenId:      number;
  buyerWallet:  string;
  txHash:       string;
  priceMinor:   number;
  email?:       string | null;
  selectedSize?: string | null;
  buyerAgentId?: number | null;
  shipping?: {
    name: string; address_line1: string; address_line2?: string | null;
    city: string; region?: string | null; postcode: string; country: string; phone: string;
  } | null;
}

export interface RrgClaimResult {
  ok:      boolean;
  status:  number;
  receipt: Record<string, unknown> | null;
  error:   string | null;
}

/**
 * Settle a room-offer purchase on RRG: the USDC is already in the shared
 * platform wallet (permit tx), so this hands RRG the tx hash plus the signed
 * room price; RRG verifies the transfer, mints to the buyer, delivers, and
 * runs the brand payout at the room price.
 */
export async function claimRoomOfferOnRrg(input: RrgClaimInput): Promise<RrgClaimResult> {
  const sig = roomOfferSig(input.tokenId, input.buyerWallet, input.priceMinor);
  if (!sig) return { ok: false, status: 500, receipt: null, error: 'VIA_PLATFORM_SECRET not configured' };
  const body: Record<string, unknown> = {
    tokenId:     input.tokenId,
    buyerWallet: input.buyerWallet,
    txHash:      input.txHash,
    via_room_offer: { price_minor: Math.floor(input.priceMinor), sig },
    ...(input.email        ? { email: input.email }                 : {}),
    ...(input.selectedSize ? { selected_size: input.selectedSize }  : {}),
    ...(input.buyerAgentId ? { buyerAgentId: input.buyerAgentId }   : {}),
    ...(input.shipping ? {
      shipping_name:          input.shipping.name,
      shipping_address_line1: input.shipping.address_line1,
      ...(input.shipping.address_line2 ? { shipping_address_line2: input.shipping.address_line2 } : {}),
      shipping_city:          input.shipping.city,
      ...(input.shipping.region ? { shipping_state: input.shipping.region } : {}),
      shipping_postal_code:   input.shipping.postcode,
      shipping_country:       input.shipping.country,
      shipping_phone:         input.shipping.phone,
      physical_terms_accepted: true,
    } : {}),
  };
  try {
    const res = await fetch(`${RRG_BASE}/api/rrg/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok || json.success !== true) {
      return { ok: false, status: res.status, receipt: json, error: typeof json.error === 'string' ? json.error : `claim failed (${res.status})` };
    }
    return { ok: true, status: res.status, receipt: json, error: null };
  } catch {
    return { ok: false, status: 502, receipt: null, error: 'could not reach RRG to settle' };
  }
}
