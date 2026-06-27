import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { getDigitalFiles, signDigitalUrl } from '@/lib/app/digital-delivery';
import ThemeToggle from '@/components/app/ThemeToggle';
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
    .select('id, slug, name, kind, headline, description, contact_email, website_url, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, active, created_at, updated_at, shopify_domain, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !seller) return notFound();

  const sellerId    = seller.id as string;
  const ownerUserId = seller.owner_user_id as string;

  // Pull the auth user's email so superadmin can see (and edit) the
  // login-of-record alongside the display-only contact email. Failures
  // here are non-fatal — we render '(unavailable)' in the UI.
  let loginEmail: string | null = null;
  try {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(ownerUserId);
    loginEmail = authUser?.user?.email ?? null;
  } catch {
    loginEmail = null;
  }

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
      .select('id, title, kind, price_minor, currency, stock, token_id, on_chain_status, active, admin_removed, admin_removed_reason, image_url, metadata')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false }),
  ]);

  // For digital products the paid asset lives in the PRIVATE bucket and is never
  // public. Sign it here so the superadmin can view it for moderation (images
  // inline, other types as a labelled link), without exposing it to anyone else.
  const rawProducts = (productsRes.data ?? []) as Array<Record<string, unknown>>;
  const products = await Promise.all(rawProducts.map(async (p) => {
    const files = getDigitalFiles(p.metadata);
    const asset = files[0];
    let admin_asset_url: string | null = null;
    if (asset) {
      try { admin_asset_url = await signDigitalUrl(asset.path); } catch { admin_asset_url = null; }
    }
    return {
      id:                   p.id as string,
      title:                p.title as string,
      kind:                 p.kind as string,
      price_minor:          p.price_minor as number,
      currency:             p.currency as string,
      stock:                p.stock as number | null,
      token_id:             p.token_id as number | null,
      on_chain_status:      p.on_chain_status as string,
      active:               p.active as boolean,
      admin_removed:        p.admin_removed as boolean,
      admin_removed_reason: p.admin_removed_reason as string | null,
      image_url:            p.image_url as string | null,
      asset_filename:       asset?.filename ?? null,
      asset_content_type:   asset?.content_type ?? null,
      asset_is_image:       asset ? Boolean(asset.content_type?.startsWith('image/')) : false,
      admin_asset_url,
    };
  }));

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/admin" aria-label="Admin overview" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> Overview
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
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Seller</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">{seller.name as string}</h1>
          <p className="text-sm text-ink-2 mb-8 font-mono">
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
              login_email:           loginEmail,
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
            products={products}
          />
        </div>
      </section>
    </main>
  );
}
