import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';
import { getShippingConfig, isShippingReady } from '@/lib/app/shipping';
import { NotificationBell } from '@/components/app/NotificationBell';

export const dynamic = 'force-dynamic';

/**
 * Seller admin landing. Reached as /seller/[slug]/admin after onboarding or
 * from /seller/login. Validates that the authenticated user owns this
 * seller row, then shows the dashboard summary + links to surfaces.
 *
 * The full Sales Agent training chat lives at /admin/sellers/[slug]/sales-agent
 * (superadmin surface) and is being ported from the RRG fork. This page surfaces
 * the seller's key state (ERC-8004 + on-chain status, MCP URL, wallets) and
 * deliberately keeps a small footprint until the chat client is properly wired.
 */
export default async function SellerAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, headline, description, website_url, contact_email, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, owner_user_id, active, created_at, shipping')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !seller) return notFound();

  const user = await getSellerUser();
  const ownsRow = user?.id === seller.owner_user_id;
  if (!ownsRow) {
    // Either signed out or signed in as someone else. Send to login.
    return notFound();
  }

  const mcpUrl  = `https://app.getvia.xyz/sellers/${seller.slug}/mcp`;
  const created = new Date(seller.created_at as string).toISOString().slice(0, 10);
  const shippingConfig = getShippingConfig(seller.shipping);
  const shippingReady  = isShippingReady(shippingConfig);
  const shippingSummary =
    shippingReady && shippingConfig?.mode === 'flat_rate'
      ? `Flat rate from ${shippingConfig.shipsFromCountry ?? '??'} · domestic $${(shippingConfig.domesticFlatUsd ?? 0).toFixed(2)}`
      : shippingReady && shippingConfig?.mode === 'quote_on_purchase'
        ? 'Quote on purchase'
        : 'Not configured yet';

  // Sales count for the dashboard CTA (full join lives behind /admin/sales).
  const { count: salesCount } = await db
    .from('app_purchases')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', seller.id as string);
  const salesSummary = (salesCount ?? 0) === 0
    ? 'No sales yet'
    : `${salesCount} sale${salesCount === 1 ? '' : 's'} recorded`;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <form action="/api/seller/auth/logout" method="post">
              <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Dashboard</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
            {seller.name}
          </h1>
          <p className="text-neutral-600 mb-10 max-w-xl">
            {(seller.description as string | null) ?? 'Your Sales Agent is provisioned and ready. The training chat surface is rolling out next; until then your agent uses the description above to introduce itself.'}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            <Stat label="Slug"          value={seller.slug as string} mono />
            <Stat label="Kind"          value={seller.kind as string} />
            <Stat label="Contact"       value={seller.contact_email as string} mono />
            <Stat label="Website"       value={(seller.website_url as string | null) ?? '(none)'} mono />
            <Stat label="Payout wallet" value={seller.wallet_address as string} mono />
            <Stat label="Agent wallet"  value={(seller.agent_wallet_address as string | null) ?? '(not provisioned)'} mono />
            <Stat label="ERC-8004 agent ID" value={(seller.erc8004_agent_id as string | null) ?? 'minting…'} mono />
            <Stat label="Status"        value={seller.active ? 'Active' : 'Inactive'} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-neutral-200 pt-8 mb-10">
            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Train your agent</p>
              <p className="text-sm text-neutral-600 mb-4 flex-grow">
                Brief your agent on what you sell, policies, promotions. Locks facts in as memories
                and reads them back to buying agents.
              </p>
              <Link
                href={`/seller/${seller.slug}/admin/sales-agent`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                Open chat <span aria-hidden>&rarr;</span>
              </Link>
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Manage products</p>
              <p className="text-sm text-neutral-600 mb-4 flex-grow">
                Add what you sell. Each product becomes discoverable by AI agents and with a
                blockchain record when you publish it. Immediately visible on the VIA MCP server.
              </p>
              <Link
                href={`/seller/${seller.slug}/admin/products`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                Open products <span aria-hidden>&rarr;</span>
              </Link>
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Shipping policy</p>
              <p className="text-sm text-neutral-600 mb-2 flex-grow">
                Flat rate or quote on purchase. If you are offering free delivery or collection enter
                zero!
              </p>
              <p className={`text-xs font-mono mb-4 ${shippingReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                {shippingSummary}
              </p>
              <Link
                href={`/seller/${seller.slug}/admin/shipping`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                {shippingReady ? 'Edit policy' : 'Set up shipping'} <span aria-hidden>&rarr;</span>
              </Link>
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Sales &amp; payouts</p>
              <p className="text-sm text-neutral-600 mb-2 flex-grow">
                Every purchase initiated through your per-seller MCP&apos;s{' '}
                <code className="font-mono text-neutral-900">buy_product</code> tool lands here. The
                97.5% seller share of each settled sale lands at your payout wallet.
              </p>
              <p className={`text-xs font-mono mb-4 ${(salesCount ?? 0) > 0 ? 'text-emerald-700' : 'text-neutral-500'}`}>
                {salesSummary}
              </p>
              <Link
                href={`/seller/${seller.slug}/admin/sales`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                Open ledger <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>

          <div className="border-t border-neutral-200 pt-8 mb-10">
            <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Your surfaces</p>
            <p className="text-sm text-neutral-600 mb-3">
              Buying agents discover you via the central MCP at{' '}
              <code className="font-mono text-neutral-900">getvia.xyz/mcp</code> and connect here for
              deeper interaction:
            </p>
            <code className="block bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm break-all mb-3">
              {mcpUrl}
            </code>
            <p className="text-sm text-neutral-600 mb-3">Humans browse your public card at:</p>
            <a
              href={`https://getvia.xyz/sellers/${seller.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm break-all hover:border-neutral-900 transition-colors"
            >
              {`https://getvia.xyz/sellers/${seller.slug}`}
            </a>
          </div>

          <div className="border-t border-neutral-200 pt-8 flex items-center justify-between">
            <Link href="/faq/sellers" className="text-xs font-mono tracking-widest uppercase text-neutral-900 hover:underline">
              New here? Read the seller FAQ <span aria-hidden>&rarr;</span>
            </Link>
            <p className="text-xs font-mono tracking-widest text-neutral-500 uppercase">
              Onboarded {created}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-1">{label}</div>
      <div className={`text-sm text-neutral-900 ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  );
}
