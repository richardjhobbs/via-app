import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';
import { getShippingConfig, isShippingReady } from '@/lib/app/shipping';
import { ShippingForm } from './ShippingForm';

export const dynamic = 'force-dynamic';

/**
 * Seller shipping policy editor.
 *
 * Two modes (see lib/app/shipping.ts):
 *   - flat_rate          ships-from country + domestic + international rates
 *   - quote_on_purchase  seller responds per order; buyer sees pending state
 *
 * The per-seller MCP's get_shipping_quote + buy_product read directly from
 * this config, so any change is live for buying agents on the next request.
 */
export default async function SellerShippingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, owner_user_id, shipping, purchase_policy')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin/shipping`)}`);
  }
  if (user.id !== seller.owner_user_id) return notFound();

  const config = getShippingConfig(seller.shipping);
  const ready  = isShippingReady(config);

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/seller/${slug}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <span className="wordmark text-ink">VIA</span>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/seller/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Shipping policy</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {seller.name}
          </h1>
          <p className="text-sm text-ink-2 mb-8 max-w-2xl">
            Tell buying agents how you ship. Flat-rate gives them an instant total; quote-on-purchase
            holds the order until you confirm the cost. The per-seller MCP&apos;s{' '}
            <code className="font-mono text-xs">get_shipping_quote</code> and{' '}
            <code className="font-mono text-xs">buy_product</code> read this in real time, so changes
            are live for the next call.
          </p>

          <ShippingForm
            sellerId={seller.id as string}
            sellerSlug={seller.slug as string}
            initialConfig={config}
            initialReady={ready}
            initialPurchasePolicy={(seller.purchase_policy as string | null) ?? ''}
          />
        </div>
      </section>
    </main>
  );
}
