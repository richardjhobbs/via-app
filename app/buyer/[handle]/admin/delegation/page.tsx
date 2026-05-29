import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { DelegationForm } from './DelegationForm';

export const dynamic = 'force-dynamic';

interface Caps {
  max_purchase_usd?: number;
  auto_buy_under_usd?: number;
  categories_allowed?: string[];
  categories_blocked?: string[];
}

export default async function BuyerDelegationPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, delegation_caps, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (!user || user.id !== buyer.owner_user_id) return notFound();

  const caps = (buyer.delegation_caps ?? {}) as Caps;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/buyer/${handle}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/buyer/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Delegation caps</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            The limits your agent buys under
          </h1>
          <p className="text-sm text-neutral-600 mb-8">
            Your agent refuses any offer that breaks these. Spend ceilings, auto-buy thresholds, and
            the categories it may or may not pursue.
          </p>

          <DelegationForm buyerId={buyer.id as string} initialCaps={caps} />
        </div>
      </section>
    </main>
  );
}
