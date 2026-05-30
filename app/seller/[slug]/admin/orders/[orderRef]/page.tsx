import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';
import { loadOrderForSeller } from '@/lib/app/orders';
import { OrderDetailView } from '@/components/app/OrderDetailView';
import { NotificationBell } from '@/components/app/NotificationBell';

export const dynamic = 'force-dynamic';

export default async function SellerOrderDetailPage({
  params,
}: {
  params: Promise<{ slug: string; orderRef: string }>;
}) {
  const { slug, orderRef } = await params;

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, name, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin/orders/${orderRef}`)}`);
  }
  if (user.id !== seller.owner_user_id) return notFound();

  const order = await loadOrderForSeller(orderRef, slug);
  if (!order) return notFound();

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/seller/${slug}/admin/sales`} aria-label="Back to sales ledger" className="inline-flex items-center gap-3">
            <span className="wordmark text-ink">VIA</span>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3">
              <span aria-hidden>&larr;</span> Sales
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <form action="/api/seller/auth/logout" method="post">
              <button className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Order</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {seller.name as string}
          </h1>
          <p className="text-sm text-ink-2 mb-8 max-w-2xl">
            Fulfilment from here is yours. Copy the address block or export it as CSV / TXT / Markdown
            for your dispatch flow. Quote the order ref in any follow-up.
          </p>

          <OrderDetailView order={order} />
        </div>
      </section>
    </main>
  );
}
