import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';
import { ProductsClient } from './ProductsClient';

export const dynamic = 'force-dynamic';

export default async function SellerProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !seller) return notFound();

  const user = await getSellerUser();
  if (!user || user.id !== seller.owner_user_id) return notFound();

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/seller/${slug}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/seller/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Products</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            {seller.name}
          </h1>
          <p className="text-sm text-neutral-600 mb-8 max-w-2xl">
            Add what you sell. Each product becomes an ERC-1155 listing on Base when you publish it,
            and immediately appears in <code className="font-mono text-neutral-900">list_products</code> on
            the per-seller MCP so buying agents can discover it.
          </p>

          <ProductsClient
            sellerId={seller.id as string}
            sellerSlug={seller.slug as string}
            sellerKind={seller.kind as string}
          />
        </div>
      </section>
    </main>
  );
}
