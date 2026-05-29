import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { SellerDetailClient } from './SellerDetailClient';

export const dynamic = 'force-dynamic';

export default async function AdminSellerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await isAdminFromCookies())) {
    const { slug } = await params;
    redirect(`/admin/login?next=/admin/sellers/${slug}`);
  }

  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, headline, description, contact_email, website_url, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, active, created_at, updated_at, shopify_domain')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !seller) return notFound();

  const sellerId = seller.id as string;

  const [memoriesRes, interactionsRes, purchasesRes, productsRes] = await Promise.all([
    db.from('app_seller_memories')
      .select('id, type, title, body, tags, active, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('app_mcp_interactions')
      .select('id, tool_name, agent_identity, status_code, duration_ms, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('app_purchases')
      .select('id, order_ref, total_usdc, status, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(20),
    db.from('app_seller_products')
      .select('id, title, on_chain_status, active')
      .eq('seller_id', sellerId),
  ]);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/admin" aria-label="Admin overview" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> Overview
            </span>
          </Link>
          <form action="/api/admin/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Seller</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">{seller.name as string}</h1>
          <p className="text-sm text-neutral-600 mb-8 font-mono">
            {seller.slug as string} · {seller.kind as string} · onboarded {new Date(seller.created_at as string).toISOString().slice(0, 10)}
          </p>

          <SellerDetailClient
            seller={{
              id:                    sellerId,
              slug:                  seller.slug as string,
              name:                  seller.name as string,
              kind:                  seller.kind as string,
              headline:              seller.headline as string | null,
              description:           seller.description as string | null,
              contact_email:         seller.contact_email as string,
              website_url:           seller.website_url as string | null,
              wallet_address:        seller.wallet_address as string,
              agent_wallet_address:  seller.agent_wallet_address as string | null,
              erc8004_seller_id:     seller.erc8004_seller_id as string | null,
              erc8004_agent_id:      seller.erc8004_agent_id as string | null,
              shopify_domain:        seller.shopify_domain as string | null,
              active:                seller.active as boolean,
            }}
            memories={(memoriesRes.data ?? []) as Array<{
              id: string; type: string; title: string; body: string; tags: string[]; active: boolean; created_at: string;
            }>}
            interactions={(interactionsRes.data ?? []) as Array<{
              id: string; tool_name: string; agent_identity: Record<string, unknown>; status_code: number | null; duration_ms: number | null; created_at: string;
            }>}
            purchases={(purchasesRes.data ?? []) as Array<{
              id: string; order_ref: string; total_usdc: number; status: string; created_at: string;
            }>}
            productCount={(productsRes.data ?? []).length}
          />
        </div>
      </section>
    </main>
  );
}
