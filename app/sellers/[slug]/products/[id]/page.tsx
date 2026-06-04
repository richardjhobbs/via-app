import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicProduct, type PublicProduct } from '@/lib/app/seller-catalog';

export const dynamic = 'force-dynamic';

function priceLabel(p: PublicProduct): string {
  if (p.price_usdc === null) return 'Price on request';
  const amount = `${p.price_usdc.toFixed(2)} ${p.currency}`;
  return p.price_is_from ? `From ${amount}` : amount;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await params;
  const found = await getPublicProduct(slug, id);
  if (!found) return { title: 'Product not found · VIA' };
  const { product } = found;
  const desc = product.description?.slice(0, 160) ?? `${product.title} from ${product.seller_name} on the VIA network.`;
  return {
    title: `${product.title} · ${product.seller_name} · VIA`,
    description: desc,
    openGraph: {
      title: product.title,
      description: desc,
      images: product.image_url ? [{ url: product.image_url }] : undefined,
      type: 'website',
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const found = await getPublicProduct(slug, id);
  if (!found) notFound();
  const { seller, product } = found;
  const configurable = product.pricing_mode === 'configurable';

  return (
    <main className="min-h-screen bg-background text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="wordmark">VIA</Link>
          <Link href={`/sellers/${seller.slug}`} className="uc-mono text-ink-3 hover:text-ink">
            {seller.name}
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <nav className="uc-mono mb-8 text-ink-3">
          <Link href={`/sellers/${seller.slug}`} className="hover:text-ink">{seller.name}</Link>
          <span className="px-2">/</span>
          <span className="text-ink">{product.title}</span>
        </nav>

        <div className="grid gap-10 md:grid-cols-2">
          <div className="bg-[var(--bg-2)] border border-line aspect-square w-full overflow-hidden">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center uc-mono text-ink-3">No image</div>
            )}
          </div>

          <div>
            <div className="uc-mono text-ink-3">{product.kind ?? 'product'}</div>
            <h1 className="font-serif mt-2 text-3xl leading-tight md:text-4xl">{product.title}</h1>
            <div className="mt-4 text-2xl">{priceLabel(product)}</div>
            {typeof product.stock === 'number' && (
              <div className="uc-mono mt-2 text-ink-3">{product.stock} in stock</div>
            )}

            {product.description && (
              <p className="mt-6 whitespace-pre-line leading-relaxed text-ink-2">{product.description}</p>
            )}

            <div className="mt-10 border border-line bg-paper p-5">
              <div className="uc-mono text-ink-3">Buy with your AI agent</div>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                VIA is agentic commerce. Purchases settle in USDC on Base through an AI agent connected over MCP.
                {configurable
                  ? ' This product is configured per order: your agent requests a quote, the seller approves, then it settles.'
                  : ' Connect your agent to the seller endpoint below to buy.'}
              </p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex gap-3">
                  <dt className="uc-mono w-24 shrink-0 text-ink-3">Seller MCP</dt>
                  <dd className="font-mono break-all text-ink">{product.mcp_ref.seller_mcp_url}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="uc-mono w-24 shrink-0 text-ink-3">Product ID</dt>
                  <dd className="font-mono break-all text-ink">{product.mcp_ref.product_id}</dd>
                </div>
                {product.mcp_ref.token_id !== null && (
                  <div className="flex gap-3">
                    <dt className="uc-mono w-24 shrink-0 text-ink-3">Token ID</dt>
                    <dd className="font-mono text-ink">{product.mcp_ref.token_id}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-xs text-ink-3">
                Agents: connect to the seller MCP and call{' '}
                <code className="font-mono">{configurable ? 'get_offering_schema → request_quote' : 'get_product → buy_product'}</code>.
              </p>
            </div>

            {seller.website_url && (
              <a href={seller.website_url} target="_blank" rel="noopener noreferrer" className="uc-mono mt-6 inline-block text-accent hover:underline">
                {seller.name} website ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
