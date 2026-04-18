import {
  getBrandBySlug,
  getApprovedDropsPaginated,
  getPurchaseCountsByTokenIds,
  getCurrentBrief,
  getVariantsBySubmissionId,
} from '@/lib/rrg/db';
import { getSignedUrl } from '@/lib/rrg/storage';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import BrandCTAs from '@/components/rrg/BrandCTAs';
import SizeSelector from '@/components/rrg/SizeSelector';
import AgentReadyBadge from '@/components/rrg/AgentReadyBadge';

export const dynamic = 'force-dynamic';

const DROPS_PER_PAGE = 50;

const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'X / Twitter', x: 'X', instagram: 'Instagram', bluesky: 'BlueSky',
  telegram: 'Telegram', discord: 'Discord', youtube: 'YouTube', tiktok: 'TikTok',
  linkedin: 'LinkedIn', github: 'GitHub', facebook: 'Facebook',
};

export default async function BrandStorefront({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const sp       = await searchParams;
  const page     = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const brand = await getBrandBySlug(slug);
  if (!brand || brand.status !== 'active') return notFound();

  let logoUrl: string | null = null;
  let bannerUrl: string | null = null;
  try { if (brand.logo_path) logoUrl = await getSignedUrl(brand.logo_path, 3600); } catch {}
  try { if (brand.banner_path) bannerUrl = await getSignedUrl(brand.banner_path, 3600); } catch {}

  const [brief, { drops, totalCount }] = await Promise.all([
    getCurrentBrief(brand.id),
    getApprovedDropsPaginated(page, DROPS_PER_PAGE, undefined, brand.id),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / DROPS_PER_PAGE));
  const tokenIds = drops.map(d => d.token_id).filter((id): id is number => id != null);
  const purchaseCounts = await getPurchaseCountsByTokenIds(tokenIds);

  const dropsWithUrls = await Promise.all(
    drops.map(async (drop) => {
      let imageUrl: string | null = null;
      try { if (drop.jpeg_storage_path) imageUrl = await getSignedUrl(drop.jpeg_storage_path, 3600); } catch {}
      const isBrandListing = drop.creator_wallet?.toLowerCase() === brand.wallet_address?.toLowerCase();

      // Fetch variants for garment brands
      let variants: { size: string | null; color: string | null; inStock: boolean; stock: number }[] = [];
      if (brand.supports_sizing) {
        const rawVariants = await getVariantsBySubmissionId(drop.id);
        variants = rawVariants.map(v => ({
          size: v.size,
          color: v.color,
          inStock: v.cached_stock > 0,
          stock: v.cached_stock,
        }));
      }

      // Sold out: for Shopify-backed brands use variant stock; otherwise use edition vs purchases
      const soldOut = variants.length > 0
        ? variants.every(v => !v.inStock)
        : (drop.token_id != null ? (purchaseCounts.get(drop.token_id) ?? 0) >= drop.edition_size : false);

      return { ...drop, imageUrl, soldOut, isBrandListing, variants };
    })
  );

  // Split into brand store items vs co-creation items
  const brandStoreItems = dropsWithUrls.filter(d => d.isBrandListing);
  const coCreationItems = dropsWithUrls.filter(d => !d.isBrandListing);

  const socialEntries = brand.social_links
    ? Object.entries(brand.social_links).filter(([, url]) => url)
    : [];

  const DropGrid = ({ items }: { items: typeof dropsWithUrls }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
      {items.map((drop) => (
        <div key={drop.id} className="group">
          <Link href={`/rrg/drop/${drop.token_id}`} className="block">
            <div className={[
              'relative aspect-square border rounded-lg overflow-hidden mb-4 transition-colors',
              // Adaptive: dark subjects on light card bg, light subjects on dark card bg.
              // Null = unknown → default dark (existing behavior).
              drop.image_is_dark === true
                ? 'bg-white border-white/20 group-hover:border-green-500/50'
                : 'bg-white/5 border-white/10 group-hover:border-green-500/30',
            ].join(' ')}>
              {drop.imageUrl ? (
                <img src={drop.imageUrl} alt={drop.title}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/30 font-mono text-sm">
                  #{drop.token_id}
                </div>
              )}
              {drop.is_physical_product && (
                <span className="absolute top-2 left-2 px-2 py-0.5 bg-lime-500 text-black text-xs font-mono uppercase tracking-wider leading-tight rounded">
                  Physical
                </span>
              )}
              {drop.enhanced_description && (
                <span className="absolute bottom-2 left-2">
                  <AgentReadyBadge />
                </span>
              )}
              {drop.soldOut && (
                <span className="absolute top-2 right-2 px-2 py-0.5 bg-red-600 text-white text-xs font-mono uppercase tracking-wider leading-tight rounded">
                  Sold Out
                </span>
              )}
            </div>
            <h3 className="text-base font-medium truncate mb-1 group-hover:opacity-70 transition-opacity">
              {drop.title}
            </h3>
            <div className="flex justify-between text-sm text-white/50 font-mono">
              <span>${parseFloat(drop.price_usdc || '0').toFixed(2)} USDC</span>
              {drop.variants.length > 0 ? (
                <span>{drop.variants.filter(v => v.inStock).length > 0
                  ? `${drop.variants.reduce((s, v) => s + v.stock, 0)} in stock`
                  : 'Out of stock'}</span>
              ) : (
                <span>{drop.edition_size} ed.</span>
              )}
            </div>
          </Link>
          {drop.variants.length > 0 && (
            <SizeSelector
              variants={drop.variants}
              productTitle={drop.title}
              dropHref={`/rrg/drop/${drop.token_id}`}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
      <div className="px-6 py-12 max-w-6xl mx-auto">

        {/* ── Brand Profile ───────────────────────────────────── */}
        <div className="mb-12">
          {bannerUrl && (
            <div className="w-full h-48 sm:h-64 mb-6 border border-white/10 rounded-lg overflow-hidden">
              <img src={bannerUrl} alt={`${brand.name} banner`} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex items-start gap-6">
            {logoUrl && (
              <div className="shrink-0 w-20 h-20 border border-white/15 rounded-lg overflow-hidden bg-white/5">
                <img src={logoUrl} alt={`${brand.name} logo`} className="w-full h-full object-contain" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              {brand.headline && <h2 className="text-3xl font-light mb-2 leading-snug">{brand.headline}</h2>}
              {brand.description && (
                <p className="text-white/80 leading-relaxed text-base">{brand.description}</p>
              )}
              {(brand.website_url || socialEntries.length > 0) && (
                <div className="flex flex-wrap items-center gap-4 mt-4">
                  {brand.website_url && (
                    <a href={brand.website_url} target="_blank" rel="noopener noreferrer"
                       className="text-sm text-white/60 hover:text-white/80 transition-colors font-mono">
                      {brand.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')} {'\u2197'}
                    </a>
                  )}
                  {socialEntries.map(([platform, url]) => (
                    <a key={platform} href={url} target="_blank" rel="noopener noreferrer"
                       className="text-sm text-white/50 hover:text-white/80 transition-colors font-mono">
                      {SOCIAL_LABELS[platform.toLowerCase()] ?? platform} {'\u2197'}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Brief Banner ─────────────────────────────────── */}
        {brief && (
          <div className="mb-10 p-8 border border-white/20 rounded-lg relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-3">Current Brief</p>
            <h2 className="text-3xl font-light mb-3 leading-snug">{brief.title}</h2>
            <div className="text-white/80 leading-relaxed mb-5 text-base whitespace-pre-line">
              {brief.description}
            </div>
            <div className="flex items-center gap-6">
              <Link href={`/brand/${slug}/submit`}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-500 text-black rounded-full font-medium hover:bg-green-400 transition-colors">
                Submit a Design &rarr;
              </Link>
              {brief.ends_at && (
                <p className="text-sm font-mono text-white/50">
                  Deadline: {new Date(brief.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Brand Store ──────────────────────────────────── */}
        {brandStoreItems.length > 0 && (
          <div className="mb-12">
            <h2 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-6">Brand Store</h2>
            <DropGrid items={brandStoreItems} />
          </div>
        )}

        {/* ── Co-Creation ──────────────────────────────────── */}
        {coCreationItems.length > 0 && (
          <div className="mb-12">
            <h2 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-6">Co-Creation</h2>
            <DropGrid items={coCreationItems} />
          </div>
        )}

        {/* Empty state */}
        {dropsWithUrls.length === 0 && (
          <div className="text-center py-32 text-white/50 font-mono text-base">
            <p>No products yet.</p>
          </div>
        )}

        {/* ── Pagination ──────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-6 mt-10 text-base font-mono">
            {page > 1 ? (
              <Link href={page === 2 ? `/brand/${slug}` : `/brand/${slug}?page=${page - 1}`}
                className="text-white/60 hover:text-green-400 transition-colors">&larr; Prev</Link>
            ) : (
              <span className="text-white/20">&larr; Prev</span>
            )}
            <span className="text-white/50 tabular-nums">{page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={`/brand/${slug}?page=${page + 1}`}
                className="text-white/60 hover:text-green-400 transition-colors">Next &rarr;</Link>
            ) : (
              <span className="text-white/20">Next &rarr;</span>
            )}
          </div>
        )}

        {/* ── CTA Buttons ─────────────────────────────────── */}
        <BrandCTAs brandSlug={slug} />

      </div>
  );
}
