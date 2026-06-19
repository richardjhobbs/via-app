/**
 * Human checkout , create a pending purchase intent for a single product, the
 * web equivalent of the seller MCP's buy_product. Returns the order_ref + the
 * USDC total + the platform wallet to pay. The browser then pays USDC on Base
 * (card on-ramp or connected wallet) and settles via POST /api/x402/purchase
 * (the SAME settlement the agent path uses , mint + 97.5% seller payout).
 *
 * Validation mirrors buy_product so the two paths can never diverge on what is
 * purchasable or what a buyer owes: transactable seller, purchasable product,
 * USDC + fixed price, stock, physical-delivery, and the shared shipping quote.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { db } from '@/lib/app/db';
import { getShippingConfig, computeShippingQuote } from '@/lib/app/shipping';
import { getDigitalFiles } from '@/lib/app/digital-delivery';

export const dynamic = 'force-dynamic';

const USDC_ADDRESS    = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

interface DeliveryInput {
  name?: string; address_line1?: string; address_line2?: string;
  city?: string; region?: string; postcode?: string; country?: string; phone?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;

  let body: { qty?: unknown; buyer_wallet?: unknown; buyer_country?: unknown; delivery?: DeliveryInput; method?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const qty          = Math.max(1, Math.min(1000, Math.floor(Number(body.qty ?? 1)) || 1));
  const buyerWallet  = String(body.buyer_wallet ?? '').trim();
  const buyerCountry = body.buyer_country ? String(body.buyer_country).trim().toUpperCase() : '';
  const method       = body.method === 'card' ? 'card' : 'usdc';
  const delivery     = body.delivery;

  if (!ethers.isAddress(buyerWallet)) {
    return NextResponse.json({ error: 'a valid wallet address is required' }, { status: 400 });
  }

  // ── Seller (must be transactable: has a store agent wallet + active) ──
  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, name, agent_wallet_address, active, shipping, owner_user_id, purchase_policy')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller || !seller.active || !seller.agent_wallet_address) {
    return NextResponse.json({ error: 'this store is not currently transactable on VIA' }, { status: 409 });
  }

  // ── Product (purchasable, fixed-price USDC) ──
  const { data: product } = await db
    .from('app_seller_products')
    .select('id, title, price_minor, currency, stock, on_chain_status, active, max_supply, kind, pricing_mode, admin_removed, metadata')
    .eq('id', id)
    .eq('seller_id', seller.id)
    .maybeSingle();
  if (!product || product.admin_removed) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 });
  }
  // A digital product with no deliverable attached cannot take money: the buyer
  // would pay and get_download_links would have nothing to hand over. Mirror the
  // MCP buy_product guard so the web and agent paths never diverge.
  if (product.kind === 'digital' && getDigitalFiles(product.metadata).length === 0) {
    return NextResponse.json({ error: 'this digital product has no deliverable file attached and cannot be purchased yet' }, { status: 409 });
  }
  if (product.pricing_mode === 'configurable') {
    return NextResponse.json({ error: 'this product is priced per order and is not available for instant checkout' }, { status: 409 });
  }
  if (!product.active || !['draft', 'registered'].includes(product.on_chain_status as string)) {
    return NextResponse.json({ error: 'product is not currently purchasable' }, { status: 409 });
  }
  if (product.currency !== 'USDC') {
    return NextResponse.json({ error: `non-USDC pricing not supported (got ${product.currency})` }, { status: 400 });
  }

  const stockNum = typeof product.stock === 'number' ? product.stock : null;
  if (stockNum !== null && qty > stockNum) {
    return NextResponse.json({ error: `only ${stockNum} in stock`, available: stockNum }, { status: 409 });
  }
  const maxSupplyNum = typeof product.max_supply === 'number' ? product.max_supply : null;
  if (maxSupplyNum !== null && qty > maxSupplyNum) {
    return NextResponse.json({ error: `edition cap is ${maxSupplyNum}` }, { status: 409 });
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

  // ── Shipping quote (shared helpers, identical math to buy_product) ──
  const country = buyerCountry || (deliveryRow?.country ?? '');
  const shippingConfig = getShippingConfig(seller.shipping);
  const shippingQuote  = country ? computeShippingQuote(shippingConfig, country) : null;
  if (shippingQuote && (shippingQuote.status === 'country_excluded' || shippingQuote.status === 'not_shipping_internationally')) {
    return NextResponse.json({ error: `cannot ship to ${country}`, shipping: shippingQuote }, { status: 409 });
  }
  const shippingUsd      = shippingQuote && shippingQuote.status === 'flat_rate' ? shippingQuote.costUsd : 0;
  const shippingUsdcMinor = Math.round(shippingUsd * 1_000_000);

  const productUsdcMinor = (product.price_minor as number) * qty;
  // Round the human charge to whole cents so the buyer pays exactly the 2dp
  // price shown on the page (older ingested rows may carry a sub-cent tail).
  const totalUsdcMinor   = Math.round((productUsdcMinor + shippingUsdcMinor) / 10_000) * 10_000;
  const productUsdc      = productUsdcMinor / 1_000_000;
  const totalUsdc        = totalUsdcMinor / 1_000_000;

  // ── Record the pending purchase ──
  const { data: purchase, error: intentErr } = await db
    .from('app_purchases')
    .insert({
      product_id:       product.id,
      seller_id:        seller.id,
      buyer_wallet:     buyerWallet.toLowerCase(),
      qty,
      total_usdc:       totalUsdc,
      payment_method:   'x402_operator',
      status:           'pending',
      delivery_address: deliveryRow,
      notes:            `web checkout (${method}); product ${productUsdc} + shipping ${shippingUsd}`,
    })
    .select('id, order_ref')
    .single();
  if (intentErr || !purchase) {
    console.error('[checkout/order] purchase insert failed', intentErr);
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
