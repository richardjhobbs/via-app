/**
 * Buy an in-room offer without leaving the room: create the pending purchase
 * intent at the ROOM price, member only. The web equivalent of the public
 * checkout's order route with two differences: the caller must be an active
 * member of the room the offer lives in, and the charge comes from the offer's
 * price_minor rather than the product's list price. The browser then pays USDC
 * on Base and settles via POST /api/x402/purchase, the SAME settlement every
 * other path uses (mint + payout split + digital delivery).
 *
 * POST { ref, buyer_wallet, qty?, buyer_country?, delivery? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { db } from '@/lib/app/db';
import { getShippingConfig, computeShippingQuote } from '@/lib/app/shipping';
import { getDigitalFiles } from '@/lib/app/digital-delivery';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { loadRoom } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { getRoomOffer } from '@/lib/app/backroom/offers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const USDC_ADDRESS    = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

interface DeliveryInput {
  name?: string; address_line1?: string; address_line2?: string;
  city?: string; region?: string; postcode?: string; country?: string; phone?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; offerId: string }> },
) {
  const { roomId, offerId } = await params;

  let body: { ref?: string; buyer_wallet?: unknown; qty?: unknown; buyer_country?: unknown; delivery?: DeliveryInput };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const ref          = body.ref?.trim() ?? '';
  const qty          = Math.max(1, Math.min(100, Math.floor(Number(body.qty ?? 1)) || 1));
  const buyerWallet  = String(body.buyer_wallet ?? '').trim();
  const buyerCountry = body.buyer_country ? String(body.buyer_country).trim().toUpperCase() : '';
  const delivery     = body.delivery;

  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  if (!ethers.isAddress(buyerWallet)) {
    return NextResponse.json({ error: 'a valid wallet address is required' }, { status: 400 });
  }

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  // The member gate: this is what makes the offer exclusive to the room.
  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const offer = await getRoomOffer(roomId, offerId);
  if (!offer) return NextResponse.json({ error: 'this offer is no longer available' }, { status: 404 });

  if (offer.remaining != null && qty > offer.remaining) {
    return NextResponse.json(
      { error: offer.remaining === 0 ? 'this offer is fully taken' : `only ${offer.remaining} left on this offer`, available: offer.remaining },
      { status: 409 },
    );
  }

  // ── Seller + product must still be purchasable (same rules as the public checkout) ──
  const { data: product } = await db
    .from('app_seller_products')
    .select('id, seller_id, title, price_minor, currency, stock, on_chain_status, active, max_supply, kind, pricing_mode, admin_removed, metadata')
    .eq('id', offer.product_id)
    .maybeSingle();
  if (!product || product.admin_removed) return NextResponse.json({ error: 'product not found' }, { status: 404 });
  if (!product.active || !['draft', 'registered'].includes(product.on_chain_status as string)) {
    return NextResponse.json({ error: 'product is not currently purchasable' }, { status: 409 });
  }
  if (product.currency !== 'USDC') {
    return NextResponse.json({ error: `non-USDC pricing not supported (got ${product.currency})` }, { status: 400 });
  }
  if (product.kind === 'digital' && getDigitalFiles(product.metadata).length === 0) {
    return NextResponse.json({ error: 'this digital product has no deliverable file attached and cannot be purchased yet' }, { status: 409 });
  }
  const stockNum = typeof product.stock === 'number' ? product.stock : null;
  if (stockNum !== null && qty > stockNum) {
    return NextResponse.json({ error: `only ${stockNum} in stock`, available: stockNum }, { status: 409 });
  }
  const maxSupplyNum = typeof product.max_supply === 'number' ? product.max_supply : null;
  if (maxSupplyNum !== null && qty > maxSupplyNum) {
    return NextResponse.json({ error: `edition cap is ${maxSupplyNum}` }, { status: 409 });
  }

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, active, agent_wallet_address, shipping')
    .eq('id', product.seller_id)
    .maybeSingle();
  if (!seller || !seller.active || !seller.agent_wallet_address) {
    return NextResponse.json({ error: 'this store is not currently transactable on VIA' }, { status: 409 });
  }

  // ── Physical delivery details ──
  let deliveryRow: Record<string, string | null> | null = null;
  if (product.kind === 'physical') {
    const required: Array<keyof DeliveryInput> = ['name', 'address_line1', 'city', 'postcode', 'country', 'phone'];
    const missing = !delivery ? required : required.filter((k) => !delivery[k] || String(delivery[k]).trim().length === 0);
    if (missing.length > 0) {
      return NextResponse.json({ error: 'delivery details required for physical items', required_fields: missing }, { status: 400 });
    }
    const country = String(delivery!.country).toUpperCase();
    if (buyerCountry && country !== buyerCountry) {
      return NextResponse.json({ error: 'buyer_country and delivery country must match' }, { status: 400 });
    }
    deliveryRow = {
      name:          delivery!.name!.trim(),
      address_line1: delivery!.address_line1!.trim(),
      address_line2: delivery!.address_line2?.trim() || null,
      city:          delivery!.city!.trim(),
      region:        delivery!.region?.trim() || null,
      postcode:      delivery!.postcode!.trim(),
      country,
      phone:         delivery!.phone!.trim(),
    };
  }

  // ── Shipping quote, identical math to the public checkout ──
  const country = product.kind === 'physical' ? (buyerCountry || (deliveryRow?.country ?? '')) : '';
  const shippingConfig = getShippingConfig(seller.shipping);
  const shippingQuote  = country ? computeShippingQuote(shippingConfig, country) : null;
  if (shippingQuote && (shippingQuote.status === 'country_excluded' || shippingQuote.status === 'not_shipping_internationally')) {
    return NextResponse.json({ error: `cannot ship to ${country}`, shipping: shippingQuote }, { status: 409 });
  }
  const shippingUsd       = shippingQuote && shippingQuote.status === 'flat_rate' ? shippingQuote.costUsd : 0;
  const shippingUsdcMinor = Math.round(shippingUsd * 1_000_000);

  // The room price, not the list price. Whole cents, like the public checkout.
  const productUsdcMinor = Math.round(offer.price_usdc * 1_000_000) * qty;
  const totalUsdcMinor   = Math.round((productUsdcMinor + shippingUsdcMinor) / 10_000) * 10_000;
  const productUsdc      = productUsdcMinor / 1_000_000;
  const totalUsdc        = totalUsdcMinor / 1_000_000;

  // Stamp the buyer's ERC-8004 agent id so settlement fires their reputation
  // signal regardless of which wallet pays (same as the public checkout).
  let buyerAgentId: string | null = null;
  const buyerUser = await getBuyerUser();
  if (buyerUser) {
    const { data: bs } = await db
      .from('app_buyers')
      .select('erc8004_agent_id, created_at')
      .eq('owner_user_id', buyerUser.id)
      .order('created_at', { ascending: true })
      .limit(1);
    const aid = bs?.[0]?.erc8004_agent_id;
    buyerAgentId = typeof aid === 'string' && aid.trim() ? aid.trim() : null;
  }

  const { data: purchase, error: intentErr } = await db
    .from('app_purchases')
    .insert({
      product_id:       product.id,
      seller_id:        seller.id,
      buyer_wallet:     buyerWallet.toLowerCase(),
      buyer_agent_id:   buyerAgentId,
      qty,
      total_usdc:       totalUsdc,
      payment_method:   'x402_operator',
      status:           'pending',
      delivery_address: deliveryRow,
      room_offer_id:    offer.id,
      notes:            `back room offer ${offer.id} (room ${roomId}, member ${auth.member.member_platform}/${auth.member.member_type}/${auth.member.member_ref}); room price ${offer.price_usdc} + shipping ${shippingUsd}`,
    })
    .select('id, order_ref')
    .single();
  if (intentErr || !purchase) {
    console.error('[backroom/offer/order] purchase insert failed', intentErr);
    return NextResponse.json({ error: 'could not create order' }, { status: 500 });
  }

  return NextResponse.json({
    order_ref:       purchase.order_ref,
    product_usdc:    productUsdc,
    shipping_usdc:   shippingUsd,
    total_usdc:      totalUsdc,
    total_minor:     totalUsdcMinor,
    usdc_address:    USDC_ADDRESS,
    platform_wallet: PLATFORM_WALLET,
    settle_endpoint: '/api/x402/purchase',
  });
}
