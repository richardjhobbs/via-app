import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicProduct, type PublicProduct } from '@/lib/app/seller-catalog';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { Wordmark } from '@/components/app/Wordmark';
import ThemeToggle from '@/components/app/ThemeToggle';
import { CheckoutBox } from './CheckoutBox';
import { CopyField } from './CopyField';

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

  // A store is transactable on VIA once it has a store agent wallet (mirrors
  // isIntegrated in the seller MCP). Human checkout only shows for transactable
  // stores selling a fixed-price USDC product.
  const { data: sellerRow } = await db
    .from('app_sellers')
    .select('agent_wallet_address')
    .eq('slug', seller.slug)
    .maybeSingle();
  const buyable = !configurable && product.price_usdc !== null && Boolean(sellerRow?.agent_wallet_address);

  // If a VIA buyer is logged in, recognise their funding wallet so the checkout
  // can greet them and confirm when their connected wallet is the VIA one they
  // onboarded with (the platform-provisioned email/Google wallet, or their own).
  let buyerWallet: string | null = null;
  let buyerName: string | null = null;
  if (buyable) {
    const user = await getBuyerUser();
    if (user) {
      const { data: b } = await db
        .from('app_buyers')
        .select('wallet_address, display_name, handle')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (b) {
        buyerWallet = (b.wallet_address as string | null) ?? null;
        buyerName = (b.display_name as string | null) ?? (b.handle as string | null) ?? null;
      }
    }
  }

  return (
    <main className="min-h-screen bg-background text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center"><Wordmark /></Link>
          <div className="flex items-center gap-4">
            <Link href={`/sellers/${seller.slug}`} className="uc-mono text-ink-3 hover:text-ink">
              {seller.name}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <nav className="uc-mono mb-8 text-ink-3">
          <Link href={`/sellers/${seller.slug}`} className="hover:text-ink">{seller.name}</Link>
          <span className="px-2">/</span>
          <span className="text-ink">{product.title}</span>
        </nav>

        {/* Data over pictures: VIA products lead with structured detail, not
            imagery. No image column , the agent buy path is the hero. */}
        <div className="max-w-2xl">
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

            {buyable && (
              <CheckoutBox
                slug={seller.slug}
                productId={product.product_id}
                priceUsdc={product.price_usdc as number}
                kind={product.kind}
                buyerWallet={buyerWallet}
                buyerName={buyerName}
              />
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
                  <dd><CopyField value={product.mcp_ref.seller_mcp_url} /></dd>
                </div>
                <div className="flex gap-3">
                  <dt className="uc-mono w-24 shrink-0 text-ink-3">Product ID</dt>
                  <dd><CopyField value={product.mcp_ref.product_id} /></dd>
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

            <div className="mt-10 border-t border-line pt-6">
              <Link href="/faq/payment" className="uc-mono hover:underline" style={{ color: 'var(--live)', fontWeight: 600 }}>
                How payment works · FAQ →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
