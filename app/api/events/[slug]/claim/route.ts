import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { claimEventPass } from '@/lib/app/event-passes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[slug]/claim — web funnel claim.
 *
 * Called by the onboarding "done" step after a buyer has just been created. It
 * binds a free guest-list pass to that buyer account. The pass is the incentive;
 * the conversion is the Buying Agent. There is no payment.
 *
 * Body: { buyer_id, tier }  (tier = the tier_key from events/<slug>.json)
 * Auth: the caller must own buyer_id (requireBuyerAuth); the email + name come
 * from the authenticated buyer, not the request body, so a pass cannot be
 * claimed under someone else's identity.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let body: { buyer_id?: unknown; tier?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const buyerId = typeof body.buyer_id === 'string' ? body.buyer_id.trim() : '';
  const tier    = typeof body.tier === 'string' ? body.tier.trim() : '';
  if (!buyerId || !tier) return NextResponse.json({ error: 'buyer_id and tier are required' }, { status: 400 });

  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  // The event store.
  const { data: seller } = await db
    .from('app_sellers')
    .select('id, name, slug, active')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller || !seller.active) return NextResponse.json({ error: `event "${slug}" not found` }, { status: 404 });

  // The buyer's display name for the guest list; email from the auth session.
  const { data: buyer } = await db
    .from('app_buyers')
    .select('id, display_name, wallet_address')
    .eq('id', buyerId)
    .maybeSingle();
  if (!buyer) return NextResponse.json({ error: 'buyer not found' }, { status: 404 });

  // Resolve the tier product by its tier_key on this store.
  const { data: product } = await db
    .from('app_seller_products')
    .select('id, metadata')
    .eq('seller_id', seller.id)
    .eq('metadata->>tier_key', tier)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: `tier "${tier}" not found for ${slug}` }, { status: 404 });

  const result = await claimEventPass({
    sellerId:     seller.id,
    productId:    product.id as string,
    name:         (buyer.display_name as string | null) ?? auth.user.email,
    email:        auth.user.email,
    buyerId:      buyerId,
    buyerWallet:  (buyer.wallet_address as string | null) ?? null,
    source:       'web_signup',
  });

  if (result.outcome === 'confirmed' || result.outcome === 'already') {
    return NextResponse.json({
      claimed: true,
      status:  result.outcome,
      event:   result.eventName,
      tier:    result.tierTitle,
    });
  }
  const status = result.outcome === 'sold_out' ? 409 : result.outcome === 'not_available' ? 404 : 500;
  return NextResponse.json({ claimed: false, error: result.outcome, message: result.error }, { status });
}
