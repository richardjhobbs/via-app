import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { listStorefront, type PublicProduct } from '@/lib/app/seller-catalog';

export const dynamic = 'force-dynamic';

function priceLabel(p: PublicProduct): string {
  if (p.price_usdc === null) return 'Price on request';
  const amount = `${p.price_usdc.toFixed(2)} ${p.currency}`;
  return p.price_is_from ? `From ${amount}` : amount;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await listStorefront(slug);
  if (!store) return { title: 'Seller not found · VIA' };
  const { seller } = store;
  const desc = seller.headline || seller.description?.slice(0, 160) || `${seller.name} on the VIA network.`;
  return {
    title: `${seller.name} · VIA`,
    description: desc,
    openGraph: { title: seller.name, description: desc, type: 'website' },
  };
}

export default async function SellerStorefront({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await listStorefront(slug);
  if (!store) notFound();
  const { seller, products } = store;

  return (
    <main className="min-h-screen bg-background text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="wordmark">VIA</Link>
          <span className="uc-mono text-ink-3">Seller</span>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="uc-mono text-ink-3">{seller.kind}</div>
        <h1 className="font-serif mt-2 text-4xl leading-tight md:text-5xl">{seller.name}</h1>
        {seller.headline && <p className="mt-4 text-xl text-ink-2">{seller.headline}</p>}
        {seller.description && <p className="mt-4 max-w-2xl leading-relaxed text-ink-2">{seller.description}</p>}
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {seller.website_url && (
            <a href={seller.website_url} target="_blank" rel="noopener noreferrer" className="uc-mono text-accent hover:underline">
              Website ↗
            </a>
          )}
          <span className="uc-mono break-all text-ink-3">MCP: {seller.mcp_url}</span>
        </div>

        <hr className="my-10 border-line" />

        {products.length === 0 ? (
          <p className="text-ink-3">No published products yet.</p>
        ) : (
          <>
            <div className="uc-mono mb-6 text-ink-3">{products.length} product{products.length === 1 ? '' : 's'}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3">
              {products.map((p) => (
                <Link key={p.product_id} href={`/sellers/${seller.slug}/products/${p.product_id}`} className="group block">
                  <div className="bg-[var(--bg-2)] border border-line aspect-square w-full overflow-hidden">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt={p.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center uc-mono text-ink-3">No image</div>
                    )}
                  </div>
                  <h2 className="font-serif mt-3 text-lg leading-snug">{p.title}</h2>
                  <div className="mt-1 text-ink-2">{priceLabel(p)}</div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
