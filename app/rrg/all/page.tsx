import { getApprovedListingsPaginated, getPurchaseCountsByTokenIds, getAllActiveBrands, RRG_BRAND_ID } from '@/lib/rrg/db';
import { getSignedUrlsBatch } from '@/lib/rrg/storage';
import { getVerifiedWallets } from '@/lib/rrg/worldid';
import { getBadgesForDrops } from '@/lib/rrg/platforms';
import { getAgentIdsForWallets } from '@/lib/rrg/erc8004';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const DROPS_PER_PAGE = 18;

function bioExcerpt(bio: string, maxLen = 90): string {
  const clean = bio
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return clean.length > maxLen ? clean.slice(0, maxLen - 2).trimEnd() + '\u2026' : clean;
}

export default async function AllDropsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; brand?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const brandParam = params.brand ?? 'all';

  const brands = await getAllActiveBrands();
  const brandMap = new Map(brands.map(b => [b.id, b]));
  const selectedBrandId = brandParam !== 'all'
    ? brands.find(b => b.slug === brandParam)?.id
    : undefined;

  const { drops, totalCount } = await getApprovedListingsPaginated(page, DROPS_PER_PAGE, undefined, selectedBrandId);
  const totalPages = Math.max(1, Math.ceil(totalCount / DROPS_PER_PAGE));

  const tokenIds = drops.map(d => d.token_id).filter((id): id is number => id != null);
  const storagePaths = drops.map(d => d.jpeg_storage_path).filter((p): p is string => !!p);

  const [purchaseCounts, signedUrlMap] = await Promise.all([
    getPurchaseCountsByTokenIds(tokenIds),
    getSignedUrlsBatch(storagePaths),
  ]);

  const dropsWithUrls = drops.map((drop) => {
    const imageUrl = drop.jpeg_storage_path ? (signedUrlMap.get(drop.jpeg_storage_path) ?? null) : null;
    const soldOut = drop.token_id != null
      ? (purchaseCounts.get(drop.token_id) ?? 0) >= drop.edition_size
      : false;
    const brand = drop.brand_id ? brandMap.get(drop.brand_id) : null;
    const brandName = brand && brand.id !== RRG_BRAND_ID ? brand.name : null;
    const brandSlug = brand && brand.id !== RRG_BRAND_ID ? brand.slug : null;
    return { ...drop, imageUrl, soldOut, brandName, brandSlug, isPhysicalProduct: drop.is_physical_product };
  });

  const creatorWallets = [...new Set(dropsWithUrls.map(d => d.creator_wallet).filter(Boolean))];
  const submissionIds = dropsWithUrls.map(d => d.id).filter(Boolean);
  const [worldVerifiedWallets, erc8004AgentIds, platformBadgesMap] = await Promise.all([
    getVerifiedWallets(creatorWallets),
    getAgentIdsForWallets(creatorWallets),
    getBadgesForDrops(creatorWallets, submissionIds),
  ]);

  const buildQs = (overrides: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    if (brandParam !== 'all') qs.set('brand', brandParam);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) qs.set(k, v); else qs.delete(k);
    }
    const str = qs.toString();
    return str ? `/rrg/all?${str}` : '/rrg/all';
  };

  return (
    <div className="px-6 py-12 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/rrg" className="text-sm text-white/50 hover:text-white transition-colors">&larr; Back</Link>
          <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60">
            All Products ({totalCount})
          </h1>
        </div>
      </div>

      {/* Grid */}
      {dropsWithUrls.length === 0 ? (
        <div className="text-center py-32 text-white/50 font-mono text-base">
          <p>No products yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {dropsWithUrls.map((drop) => (
            <div key={drop.id}>
              <Link href={`/rrg/listing/${drop.token_id}`} className="group block">
                <div className={[
                  'relative aspect-square border rounded-lg overflow-hidden mb-4 transition-colors',
                  drop.image_is_dark === true
                    ? 'bg-white border-white/20 group-hover:border-green-500/50'
                    : 'bg-white/5 border-white/10 group-hover:border-green-500/30',
                ].join(' ')}>
                  {drop.imageUrl ? (
                    <img
                      src={drop.imageUrl}
                      alt={drop.title}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/30 font-mono text-sm">
                      #{drop.token_id}
                    </div>
                  )}
                  {drop.isPhysicalProduct && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 bg-lime-500 text-black text-xs font-mono uppercase tracking-wider leading-tight rounded">
                      Physical
                    </span>
                  )}
                  {drop.soldOut && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 bg-red-600 text-white text-xs font-mono uppercase tracking-wider leading-tight rounded">
                      Sold Out
                    </span>
                  )}
                  {drop.creator_wallet && (
                    <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                      {worldVerifiedWallets.has(drop.creator_wallet.toLowerCase()) && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-cyan-600/80 text-white text-xs font-mono uppercase tracking-wider leading-tight rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                          World ID
                        </span>
                      )}
                      {erc8004AgentIds.has(drop.creator_wallet.toLowerCase()) && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-600/80 text-white text-xs font-mono uppercase tracking-wider leading-tight rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                          8004 #{erc8004AgentIds.get(drop.creator_wallet.toLowerCase())}
                        </span>
                      )}
                      {(platformBadgesMap.get(drop.creator_wallet.toLowerCase()) ?? []).slice(0, 2).map((pb) => (
                        <span
                          key={pb.platformSlug}
                          className="flex items-center gap-1 px-2 py-0.5 text-white text-xs font-mono uppercase tracking-wider leading-tight rounded"
                          style={{ backgroundColor: `${pb.accentColor}cc` }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                          {pb.platformName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <h3 className="text-base font-medium truncate mb-1 group-hover:opacity-70 transition-opacity">
                  {drop.title}
                </h3>
                <div className="flex justify-between text-sm text-white/50 font-mono">
                  <span>${parseFloat(drop.price_usdc || '0').toFixed(2)} USDC</span>
                  <span>{drop.edition_size} ed.</span>
                </div>
              </Link>
              {drop.brandName && drop.brandSlug && (
                <Link
                  href={`/brand/${drop.brandSlug}`}
                  className="mt-1.5 block text-sm font-mono text-white/50 hover:text-green-400 transition-colors"
                >
                  by {drop.brandName}
                </Link>
              )}
              {drop.brandName && !drop.brandSlug && (
                <p className="mt-1.5 text-sm font-mono text-white/50">by {drop.brandName}</p>
              )}
              {drop.creator_bio && bioExcerpt(drop.creator_bio) && (
                <p className="mt-2 text-sm text-white/50 leading-snug line-clamp-2">
                  {bioExcerpt(drop.creator_bio)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-6 mt-10 text-base font-mono">
          {page > 1 ? (
            <Link
              href={page === 2 ? buildQs({ page: undefined }) : buildQs({ page: String(page - 1) })}
              className="text-white/60 hover:text-green-400 transition-colors"
            >
              &larr; Prev
            </Link>
          ) : (
            <span className="text-white/20">&larr; Prev</span>
          )}
          <span className="text-white/50 tabular-nums">{page} / {totalPages}</span>
          {page < totalPages ? (
            <Link
              href={buildQs({ page: String(page + 1) })}
              className="text-white/60 hover:text-green-400 transition-colors"
            >
              Next &rarr;
            </Link>
          ) : (
            <span className="text-white/20">Next &rarr;</span>
          )}
        </div>
      )}
    </div>
  );
}
