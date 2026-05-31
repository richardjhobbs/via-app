import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { getSellerUser, getUserBrands } from '@/lib/app/seller-auth';
import SellerDashboardClient, {
  type ActivityRow, type NegotiationRow, type ListingRow,
} from './SellerDashboardClient';

export const dynamic = 'force-dynamic';

const OPEN_STATUSES = ['pending_seller_approval', 'countered_by_buyer', 'revised_by_seller'];

interface ThreadRound { by?: string; total_usdc?: number | null; at?: string }

/**
 * Seller admin landing, in the Maison visual language. Every figure on it is
 * read live from this seller's own rows: products (app_seller_products),
 * negotiation threads (app_seller_quotes) and settled payouts
 * (app_distributions). Nothing here is seeded.
 */
export default async function SellerAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin`)}`);
  }
  if (user.id !== seller.owner_user_id) return notFound();

  const sellerId = seller.id as string;

  // ── Real data, scoped to this seller ───────────────────────────────────
  const [brandsRaw, productsRes, quotesRes, distrosRes] = await Promise.all([
    getUserBrands(user.id),
    db.from('app_seller_products')
      .select('id, title, kind, price_minor, currency, pricing_mode, active, on_chain_status')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(200),
    db.from('app_seller_quotes')
      .select('id, quote_ref, product_id, buyer_agent_id, contact, status, proposed_total_usdc, approved_total_usdc, thread, updated_at')
      .eq('seller_id', sellerId)
      .order('updated_at', { ascending: false })
      .limit(200),
    db.from('app_distributions')
      .select('seller_usdc, status')
      .eq('seller_id', sellerId)
      .eq('status', 'paid'),
  ]);

  const products = productsRes.data ?? [];
  const quotes   = quotesRes.data ?? [];
  const titleById = new Map(products.map((p) => [p.id as string, p.title as string]));

  const brands = brandsRaw
    .map((b) => ({ slug: b.sellerSlug, name: b.sellerName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Metrics ────────────────────────────────────────────────────────────
  const productsLive  = products.filter((p) => p.active).length;
  const quotesTotal   = quotes.length;
  const inNegotiation = quotes.filter((q) => OPEN_STATUSES.includes(String(q.status))).length;
  const paidOutUsdc   = (distrosRes.data ?? []).reduce((sum, d) => sum + Number(d.seller_usdc ?? 0), 0);

  // ── Live activity: every negotiation round, newest first ───────────────
  const activity: ActivityRow[] = [];
  for (const q of quotes) {
    const item = q.product_id ? (titleById.get(q.product_id as string) ?? 'Custom order') : 'Custom order';
    const thread = Array.isArray(q.thread) ? (q.thread as ThreadRound[]) : [];
    for (const r of thread) {
      activity.push({
        at:       String(r.at ?? q.updated_at ?? ''),
        who:      String(r.by ?? 'agent'),
        quoteRef: String(q.quote_ref ?? ''),
        item,
        amount:   typeof r.total_usdc === 'number' ? r.total_usdc : null,
        status:   String(q.status),
      });
    }
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));
  const activityTop = activity.slice(0, 8);

  // ── Open negotiations ──────────────────────────────────────────────────
  const negotiations: NegotiationRow[] = quotes
    .filter((q) => OPEN_STATUSES.includes(String(q.status)))
    .slice(0, 6)
    .map((q) => ({
      quoteRef: String(q.quote_ref ?? ''),
      item:     q.product_id ? (titleById.get(q.product_id as string) ?? 'Custom order') : 'Custom order',
      buyer:    q.buyer_agent_id ? `AGENT #${q.buyer_agent_id}` : (q.contact ? String(q.contact) : 'Buying agent'),
      proposed: typeof q.proposed_total_usdc === 'number' ? q.proposed_total_usdc : null,
      status:   String(q.status),
    }));

  // ── Listings ───────────────────────────────────────────────────────────
  const listings: ListingRow[] = products.slice(0, 12).map((p) => ({
    title:       String(p.title ?? 'Untitled'),
    kind:        String(p.kind ?? 'item'),
    price:       Number(p.price_minor ?? 0) / 1_000_000,
    pricingMode: String(p.pricing_mode ?? 'fixed'),
    status:      p.active ? (p.on_chain_status === 'registered' ? 'LIVE' : 'DRAFT') : 'PAUSED',
  }));

  const agentCode = `${(seller.slug as string).toUpperCase().replace(/[^A-Z0-9]/g, '')}·SA`;
  const mcpUrl = `https://app.getvia.xyz/sellers/${seller.slug}/mcp`;

  return (
    <SellerDashboardClient
      name={seller.name as string}
      slug={seller.slug as string}
      agentCode={agentCode}
      mcpUrl={mcpUrl}
      brands={brands}
      metrics={{ productsLive, quotesTotal, inNegotiation, paidOutUsdc }}
      activity={activityTop}
      negotiations={negotiations}
      listings={listings}
    />
  );
}
