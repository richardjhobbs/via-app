import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isAdminFromCookies } from '@/lib/app/auth';
import { loadOrderByRef } from '@/lib/app/orders';
import { OrderDetailView } from '@/components/app/OrderDetailView';
import ThemeToggle from '@/components/app/ThemeToggle';

export const dynamic = 'force-dynamic';

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderRef: string }>;
}) {
  const { orderRef } = await params;

  if (!(await isAdminFromCookies())) {
    redirect(`/admin/login?next=/admin/orders/${orderRef}`);
  }

  const order = await loadOrderByRef(orderRef);
  if (!order) return notFound();

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/admin/sellers/${order.seller.slug}`} aria-label="Back to seller view" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> {order.seller.slug}
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <ThemeToggle className="on-dark" />
            <form action="/api/admin/auth/logout" method="post">
              <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Superadmin · Order</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {order.seller.name}
          </h1>
          <p className="text-sm text-neutral-600 mb-8 max-w-2xl">
            Read-only ledger view for staff. Seller controls fulfilment from their own dashboard at{' '}
            <code className="font-mono text-neutral-900">/seller/{order.seller.slug}/admin/orders/{order.order_ref}</code>.
          </p>

          <OrderDetailView order={order} />
        </div>
      </section>
    </main>
  );
}
