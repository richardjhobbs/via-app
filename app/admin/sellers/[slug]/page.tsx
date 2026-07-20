import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { getDigitalFiles, signDigitalUrl } from '@/lib/app/digital-delivery';
import ThemeToggle from '@/components/app/ThemeToggle';
import { SellerDetailClient } from './SellerDetailClient';
import { AdminTeamSection } from './AdminTeamSection';
import { listTeam } from '@/lib/app/seller-team';

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

  const team = await listTeam(sellerId);

  const [memoriesRes, interactionsRes, purchasesRes, productsRes, guestsRes] = await Promise.all([
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
      .select('id, title, description, url, kind, price_minor, currency, stock, token_id, on_chain_status, active, admin_removed, admin_removed_reason, image_url, metadata')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false }),
    // Free event-pass claims. These are guest-list rows, not purchases (no
    // payment, no x402), so without this section a free-event store looks
    // dead on superadmin even while passes are being claimed.
    db.from('app_event_guests')
      .select('id, product_id, name, email, source, status, claimed_at')
      .eq('seller_id', sellerId)
      .order('claimed_at', { ascending: false })
      .limit(100),
  ]);

  const guests = (guestsRes.data ?? []) as Array<{
    id: string; product_id: string; name: string; email: string; source: string; status: string; claimed_at: string;
  }>;
  const tierTitleById = new Map(
    ((productsRes.data ?? []) as Array<Record<string, unknown>>).map((p) => [p.id as string, p.title as string]),
  );

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
      description:          p.description as string | null,
      url:                  p.url as string | null,
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

          {guests.length > 0 && (
            <div className="mt-10">
              <div className="flex items-end justify-between mb-4">
                <h2 className="font-serif text-2xl tracking-tight">Event passes</h2>
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
                  {guests.length} claimed
                </span>
              </div>
              <p className="text-xs text-ink-3 mb-4 max-w-2xl">
                Free guest-list claims. These are not purchases: there is no payment and no
                settlement, so they appear here and on the seller&rsquo;s guest list, never under sales.
              </p>
              <div className="bg-paper border border-line rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-background text-xs font-mono uppercase tracking-widest text-ink-3">
                    <tr>
                      <th className="text-left px-4 py-3">Name</th>
                      <th className="text-left px-4 py-3">Email</th>
                      <th className="text-left px-4 py-3">Tier</th>
                      <th className="text-left px-4 py-3">Source</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Claimed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--line)]">
                    {guests.map((g) => (
                      <tr key={g.id} className="hover:bg-background">
                        <td className="px-4 py-3">{g.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2">{g.email}</td>
                        <td className="px-4 py-3 text-xs text-ink-2">{tierTitleById.get(g.product_id) ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">{g.source}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded ${
                            g.status === 'confirmed' ? 'bg-emerald-100 text-emerald-900' : 'bg-neutral-200 text-neutral-700'
                          }`}>
                            {g.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">{new Date(g.claimed_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-10">
            <AdminTeamSection
              sellerId={sellerId}
              sellerName={seller.name as string}
              initialMembers={team.members}
              initialInvites={team.invites}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
