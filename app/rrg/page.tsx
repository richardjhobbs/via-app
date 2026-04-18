import { getApprovedDropsPaginated, getPurchaseCountsByTokenIds, getCurrentBrief, getOpenBriefs, getAllActiveBrands, getBrandsForDirectory, RRG_BRAND_ID } from '@/lib/rrg/db';
import type { BrandDirectoryItem } from '@/lib/rrg/db';
import { getSignedUrl, getSignedUrlsBatch } from '@/lib/rrg/storage';
import { getVerifiedWallets } from '@/lib/rrg/worldid';
import { getBadgesForDrops, type PlatformBadgeInfo } from '@/lib/rrg/platforms';
import { getAgentIdsForWallets } from '@/lib/rrg/erc8004';
import Link from 'next/link';
// AgentTrustBadge moved to RRGFooter
import BrandDirectory from '@/components/rrg/BrandDirectory';
import BringYourStoreBlock from '@/components/rrg/BringYourStoreBlock';
import HeroSplit from '@/components/rrg/HeroSplit';
import LandingCTAs from '@/components/rrg/LandingCTAs';
import StoreCarousel from '@/components/rrg/StoreCarousel';
import BrandCTAs from '@/components/rrg/BrandCTAs';
import ShopWithAI from '@/components/rrg/ShopWithAI';

export const dynamic = 'force-dynamic';

const CAROUSEL_LIMIT = 10;

// Social platform display names
const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'X / Twitter', x: 'X', instagram: 'Instagram', bluesky: 'BlueSky',
  telegram: 'Telegram', discord: 'Discord', youtube: 'YouTube', tiktok: 'TikTok',
  linkedin: 'LinkedIn', github: 'GitHub', facebook: 'Facebook',
};

export default async function RRGGallery({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; brief?: string; brand?: string }>;
}) {
  const params     = await searchParams;
  const brandParam = params.brand ?? 'all';

  // Fetch brands + briefs in parallel
  const [brands, directoryBrands, brief, openBriefs] = await Promise.all([
    getAllActiveBrands(),
    getBrandsForDirectory(),
    getCurrentBrief(),
    getOpenBriefs(),
  ]);

  // Smart ordering for brand directory
  function orderBrandsForDirectory(items: BrandDirectoryItem[]): BrandDirectoryItem[] {
    const used = new Set<string>();
    const ordered: BrandDirectoryItem[] = [];

    const byNewest = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const b of byNewest) {
      if (ordered.length >= 4) break;
      ordered.push(b); used.add(b.id);
    }

    const byRecentProduct = [...items]
      .filter((b) => !used.has(b.id) && b.latest_product_at)
      .sort((a, b) => (b.latest_product_at ?? '').localeCompare(a.latest_product_at ?? ''));
    for (const b of byRecentProduct) {
      if (ordered.length >= 8) break;
      ordered.push(b); used.add(b.id);
    }

    const byMostProducts = [...items]
      .filter((b) => !used.has(b.id))
      .sort((a, b) => b.product_count - a.product_count);
    for (const b of byMostProducts) {
      if (ordered.length >= 12) break;
      ordered.push(b); used.add(b.id);
    }

    const remainder = items.filter((b) => !used.has(b.id));
    for (let i = remainder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainder[i], remainder[j]] = [remainder[j], remainder[i]];
    }
    ordered.push(...remainder);
    return ordered;
  }

  const sortedBrands = orderBrandsForDirectory(directoryBrands);

  // Generate signed URLs for logos AND banners
  const allPaths = [
    ...sortedBrands.map(b => b.logo_path).filter((p): p is string => !!p),
    ...sortedBrands.map(b => b.banner_path).filter((p): p is string => !!p),
  ];
  const urlMap = await getSignedUrlsBatch(allPaths);

  const brandsWithImages = sortedBrands.map((b) => ({
    slug: b.slug,
    name: b.name,
    headline: b.headline,
    logoUrl: b.logo_path ? (urlMap.get(b.logo_path) ?? null) : null,
    bannerUrl: b.banner_path ? (urlMap.get(b.banner_path) ?? null) : null,
    productCount: b.product_count,
  }));

  // Resolve selected brand
  const selectedBrand = brandParam !== 'all'
    ? brands.find(b => b.slug === brandParam) ?? null
    : null;
  const selectedBrandId = selectedBrand?.id ?? undefined;

  const [brandLogoUrl, brandBannerUrl] = await Promise.all([
    selectedBrand?.logo_path
      ? getSignedUrl(selectedBrand.logo_path, 3600).catch(() => null)
      : Promise.resolve(null),
    selectedBrand?.banner_path
      ? getSignedUrl(selectedBrand.banner_path, 3600).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Brand lookup map
  const brandMap = new Map(brands.map(b => [b.id, b]));

  // Fetch most recent drops for carousel
  const { drops } = await getApprovedDropsPaginated(1, CAROUSEL_LIMIT, undefined, selectedBrandId);

  // Get purchase counts + signed URLs
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
    return {
      id: drop.id,
      token_id: drop.token_id,
      title: drop.title,
      price_usdc: drop.price_usdc || '0',
      edition_size: drop.edition_size,
      imageUrl,
      soldOut,
      isPhysicalProduct: drop.is_physical_product,
    };
  });

  // Enrich open briefs with brand info
  const enrichedBriefs = openBriefs.map((b) => {
    const brand = b.brand_id ? brandMap.get(b.brand_id) : null;
    return {
      ...b,
      brand_name: brand?.name,
      brand_slug: brand?.slug,
    };
  });

  const enrichedLatest = brief ? {
    ...brief,
    brand_name: brief.brand_id ? brandMap.get(brief.brand_id)?.name : undefined,
    brand_slug: brief.brand_id ? brandMap.get(brief.brand_id)?.slug : undefined,
  } : null;

  // Parse social links for selected brand
  const brandSocialEntries = selectedBrand?.social_links
    ? Object.entries(selectedBrand.social_links).filter(([, url]) => url)
    : [];

  return (
    <div className="px-6 py-12 max-w-6xl mx-auto overflow-hidden">

      {/* ── Brand Profile (when a specific brand is selected) ──────── */}
      {selectedBrand && (
        <div className="mb-12">
          {brandBannerUrl && (
            <div className="w-full h-48 sm:h-64 mb-6 border border-white/10 rounded-lg overflow-hidden">
              <img
                src={brandBannerUrl}
                alt={`${selectedBrand.name} banner`}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex items-start gap-6">
            {brandLogoUrl && (
              <div className="shrink-0 w-20 h-20 border border-white/15 rounded-lg overflow-hidden bg-white/5">
                <img src={brandLogoUrl} alt={`${selectedBrand.name} logo`} className="w-full h-full object-contain" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-3xl font-light mb-1 leading-snug">{selectedBrand.name}</h2>
              {selectedBrand.headline && (
                <p className="text-base text-white/70 mb-2">{selectedBrand.headline}</p>
              )}
              {selectedBrand.description && (
                <p className="text-white/80 leading-relaxed text-base">{selectedBrand.description}</p>
              )}
              {(selectedBrand.website_url || brandSocialEntries.length > 0) && (
                <div className="flex flex-wrap items-center gap-4 mt-4">
                  {selectedBrand.website_url && (
                    <a href={selectedBrand.website_url} target="_blank" rel="noopener noreferrer"
                       className="text-sm text-white/60 hover:text-white/90 transition-colors font-mono">
                      {selectedBrand.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')} {'\u2197'}
                    </a>
                  )}
                  {brandSocialEntries.map(([platform, url]) => (
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
      )}

      {/* ── Headline ──────────────────────────────────────────────── */}
      <div className="mb-12">
        <h2 className="text-3xl sm:text-4xl font-light leading-snug mb-4">
          Welcome to the future of retail
        </h2>
        <div className="space-y-2 text-base text-white/70 leading-relaxed">
          <p>
            Real Real Genuine is where your Personal Shopper or Concierge come to life.
            Buying and selling is smooth and efficient. Better for all.
          </p>
          <p>
            Get your own Personal Shopper to find what you want, or upgrade to a
            Concierge that knows your taste and acts on your behalf.
          </p>
          <p>Collaborate with brands with mutual rewards.</p>
        </div>
      </div>

      {/* ── Hero Split: Agent Launch + Co-Creation ──────────────────── */}
      <HeroSplit openBriefs={enrichedBriefs} />

      {/* ── Shop with your AI assistant (connect guides) ────────────── */}
      <ShopWithAI />

      {/* ── Brands ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-4">Brands</h2>
        <BrandDirectory brands={brandsWithImages} />
      </div>

      {/* ── Founding-merchant onboarding block ─────────────────────── */}
      <BringYourStoreBlock />

      {/* ── CTA Row ─────────────────────────────────────────────────── */}
      <LandingCTAs latestBrief={enrichedLatest} openBriefs={enrichedBriefs} />

      {/* ── Store Carousel ──────────────────────────────────────────── */}
      <StoreCarousel drops={dropsWithUrls} />

      {/* ── Drops Coming Soon ───────────────────────────────────────── */}
      <div className="mb-16">
        <h2 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-4">Drops</h2>
        <div className="border border-white/10 border-dashed rounded-lg p-12 text-center">
          <p className="text-white/40 text-sm font-mono uppercase tracking-wider">Coming Soon</p>
        </div>
      </div>

      {/* ── CTA Buttons (For Creators / For Brands / For Agents) ──── */}
      <BrandCTAs brandSlug="" />

    </div>
  );
}
