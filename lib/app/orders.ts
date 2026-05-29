import { db } from './db';
import type { OrderDetail } from '@/components/app/OrderDetailView';

/**
 * Load a purchase row by order_ref and shape it for OrderDetailView.
 * Returns null if not found. The caller is responsible for authz
 * (seller-auth, admin-auth, etc.).
 */
export async function loadOrderByRef(orderRef: string): Promise<OrderDetail | null> {
  const { data, error } = await db
    .from('app_purchases')
    .select(`
      order_ref,
      status,
      qty,
      total_usdc,
      payment_method,
      buyer_wallet,
      buyer_agent_id,
      mint_tx_hash,
      payout_tx_hash,
      notes,
      delivery_address,
      created_at,
      updated_at,
      seller_id,
      app_seller_products!inner ( title, kind, token_id ),
      app_sellers!inner ( slug, name, contact_email ),
      app_distributions ( seller_usdc, platform_usdc, status, seller_tx_hash )
    `)
    .eq('order_ref', orderRef)
    .maybeSingle();

  if (error || !data) return null;

  const productRaw = data.app_seller_products as unknown;
  const sellerRaw  = data.app_sellers          as unknown;
  const product = (Array.isArray(productRaw) ? productRaw[0] : productRaw) as { title: string; kind: string; token_id: number | null } | null;
  const seller  = (Array.isArray(sellerRaw)  ? sellerRaw[0]  : sellerRaw)  as { slug: string; name: string; contact_email: string } | null;
  const distroArr = ((data.app_distributions ?? []) as unknown) as Array<{ seller_usdc: number; platform_usdc: number; status: string; seller_tx_hash: string | null }>;
  const distro   = distroArr.length > 0 ? distroArr[0] : null;

  if (!product || !seller) return null;

  return {
    order_ref:        data.order_ref as string,
    status:           data.status as OrderDetail['status'],
    created_at:       data.created_at as string,
    updated_at:       data.updated_at as string,
    qty:              data.qty as number,
    total_usdc:       Number(data.total_usdc ?? 0),
    payment_method:   data.payment_method as string,
    buyer_wallet:     data.buyer_wallet as string,
    buyer_agent_id:   (data.buyer_agent_id as string | null) ?? null,
    mint_tx_hash:     (data.mint_tx_hash as string | null) ?? null,
    payout_tx_hash:   (data.payout_tx_hash as string | null) ?? null,
    notes:            (data.notes as string | null) ?? null,
    delivery_address: (data.delivery_address as OrderDetail['delivery_address']) ?? null,
    product,
    seller,
    distribution: distro
      ? {
          seller_usdc:    Number(distro.seller_usdc   ?? 0),
          platform_usdc:  Number(distro.platform_usdc ?? 0),
          status:         distro.status,
          seller_tx_hash: distro.seller_tx_hash,
        }
      : null,
  };
}

/**
 * Same as loadOrderByRef but additionally enforces seller ownership.
 * Returns null when the order does not exist OR belongs to a different
 * seller from the slug.
 */
export async function loadOrderForSeller(orderRef: string, sellerSlug: string): Promise<OrderDetail | null> {
  const order = await loadOrderByRef(orderRef);
  if (!order) return null;
  if (order.seller.slug !== sellerSlug) return null;
  return order;
}
