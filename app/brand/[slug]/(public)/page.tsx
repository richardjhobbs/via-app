import {
  getBrandBySlug,
  getApprovedDropsPaginated,
  getPurchaseCountsByTokenIds,
  getCurrentBrief,
  getVariantsBySubmissionId,
  getBrandSalesStats,
} from '@/lib/rrg/db';
import { getSignedUrl, getSignedUrlsBatch } from '@/lib/rrg/storage';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PER_PAGE = 48;

const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'Twitter', x: 'X', instagram: 'Instagram', bluesky: 'BlueSky',
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
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const brand = await getBrandBySlug(slug);
  if (!brand || brand.status !== 'active') return notFound();

  const [logoUrl, bannerUrl, brief, { drops, totalCount }, salesStats] = await Promise.all([
    brand.logo_path ? getSignedUrl(brand.logo_path, 3600).catch(() => null) : Promise.resolve(null),
    brand.banner_path ? getSignedUrl(brand.banner_path, 3600).catch(() => null) : Promise.resolve(null),
    getCurrentBrief(brand.id),
    getApprovedDropsPaginated(page, PER_PAGE, undefined, brand.id),
    getBrandSalesStats(brand.id),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
  const tokenIds = drops.map(d => d.token_id).filter((id): id is number => id != null);
  const [purchaseCounts, imageUrlMap] = await Promise.all([
    getPurchaseCountsByTokenIds(tokenIds),
    getSignedUrlsBatch(drops.map(d => d.jpeg_storage_path).filter((p): p is string => !!p)),
  ]);

  const dropsWithExtras = await Promise.all(
    drops.map(async (d) => {
      const imageUrl = d.jpeg_storage_path ? imageUrlMap.get(d.jpeg_storage_path) ?? null : null;
      const isBrandListing = d.creator_wallet?.toLowerCase() === brand.wallet_address?.toLowerCase();
      let variantsInStock = 0;
      if (brand.supports_sizing) {
        const raw = await getVariantsBySubmissionId(d.id);
        variantsInStock = raw.reduce((sum, v) => sum + Math.max(0, v.cached_stock), 0);
      }
      const soldOut = brand.supports_sizing
        ? variantsInStock === 0 && !!d.token_id
        : d.token_id != null ? (purchaseCounts.get(d.token_id) ?? 0) >= d.edition_size : false;
      return { ...d, imageUrl, isBrandListing, soldOut };
    })
  );

  const brandStoreItems = dropsWithExtras.filter(d => d.isBrandListing);
  const coCreationItems = dropsWithExtras.filter(d => !d.isBrandListing);

  const socialEntries = brand.social_links
    ? Object.entries(brand.social_links).filter(([, url]) => url)
    : [];

  const admittedSince = new Date(brand.created_at).toLocaleDateString('en-GB', {
    month: 'short', year: 'numeric',
  });

  const LookbookGrid = ({ items }: { items: typeof dropsWithExtras }) => (
    <div className="look-grid">
      {items.map(drop => (
        <Link key={drop.id} className="look-item" href={`/rrg/drop/${drop.token_id}`}>
          <div
            className="look-image"
            style={drop.imageUrl ? { backgroundImage: `url('${drop.imageUrl}')` } : undefined}
          />
          <h4 className="look-name">{drop.title}</h4>
          <p className="look-brand">{brand.name}</p>
          <div className="look-meta">
            <span className="price">${parseFloat(drop.price_usdc || '0').toFixed(0)}</span>
            <span>{drop.soldOut ? 'Sold out' : 'Available'}</span>
          </div>
          {drop.enhanced_description && (
            <div className="agent-reveal">
              <span className="tag">Agent sheet →</span> {shortAgentSheet(drop.enhanced_description)}
            </div>
          )}
        </Link>
      ))}
    </div>
  );

  return (
    <>
      {/* ─── Brand cover ─── */}
      <div
        className="brand-cover"
        style={bannerUrl ? {
          backgroundImage: `url('${bannerUrl}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : { background: 'var(--bg-2)' }}
      >
        {bannerUrl && <div className="brand-cover-overlay" />}
        <div className="brand-cover-inner" style={!bannerUrl ? { color: 'var(--ink)' } : undefined}>
          <div className="brand-cover-top">
            <span className="feat-chip" style={!bannerUrl ? { background: 'var(--paper)', color: 'var(--ink-2)', borderColor: 'var(--line-strong)' } : undefined}>
              Admitted {admittedSince}
            </span>
            {logoUrl && (
              <div className="brand-cover-logo">
                <img src={logoUrl} alt={`${brand.name} logo`} />
              </div>
            )}
          </div>
          <div className="brand-cover-bottom">
            <div>
              <h1 className="brand-cover-name" style={!bannerUrl ? { color: 'var(--ink)' } : undefined}>{brand.name}</h1>
              {brand.headline && (
                <p
                  className="brand-cover-headline"
                  style={!bannerUrl ? { color: 'var(--ink-2)' } : undefined}
                >
                  {brand.headline}
                </p>
              )}
            </div>
            <div
              className="brand-cover-meta"
              style={!bannerUrl ? { color: 'var(--ink-3)' } : undefined}
            >
              <span>{totalCount} pieces</span>
              {salesStats.totalSales > 0 && <span>{salesStats.totalSales} sold</span>}
              <span>Agent-ready</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Intro strip ─── */}
      {(brand.description || brand.website_url || socialEntries.length > 0) && (
        <div className="brand-intro">
          <div className="brand-intro-desc">
            {brand.description}
          </div>
          <div className="brand-intro-side">
            {brand.website_url && (
              <a href={brand.website_url} target="_blank" rel="noopener noreferrer">
                {brand.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
              </a>
            )}
            {socialEntries.map(([platform, url]) => (
              <a key={platform} href={url} target="_blank" rel="noopener noreferrer">
                {SOCIAL_LABELS[platform.toLowerCase()] ?? platform} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="page-pad">
        {/* ─── Open brief (if any) ─── */}
        {brief && (
          <>
            <div className="section-head" style={{ borderTop: 'none', marginTop: 0, paddingTop: 48 }}>
              <div>
                <div className="section-note">§ Open brief</div>
                <h3>{brief.title}</h3>
              </div>
              <div className="sh-right">
                {brief.ends_at && (
                  <span>Closes {new Date(brief.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</span>
                )}
              </div>
            </div>
            <div className="collab-card" style={{ marginBottom: 40, padding: '32px 36px' }}>
              <div style={{ whiteSpace: 'pre-line', color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.65, marginBottom: 20, maxWidth: '72ch' }}>
                {brief.description}
              </div>
              <div className="c-cta">
                <Link href={`/brand/${slug}/submit`} className="btn" style={{ fontSize: 12, padding: '10px 18px' }}>
                  Submit a design <span className="arrow">→</span>
                </Link>
                <span className="deadline">{brief.response_count} creators responding</span>
              </div>
            </div>
          </>
        )}

        {/* ─── In the shop ─── */}
        {brandStoreItems.length > 0 && (
          <>
            <div className="section-head">
              <div>
                <div className="section-note">§ In the shop</div>
                <h3>From <em>{brand.name}</em>.</h3>
              </div>
              <div className="sh-right">
                <span>{brandStoreItems.length} pieces</span>
              </div>
            </div>
            <LookbookGrid items={brandStoreItems} />
          </>
        )}

        {/* ─── Co-created ─── */}
        {coCreationItems.length > 0 && (
          <>
            <div className="section-head">
              <div>
                <div className="section-note">§ Co-created</div>
                <h3>Made with creators.</h3>
              </div>
              <div className="sh-right">
                <span>{coCreationItems.length} pieces</span>
              </div>
            </div>
            <LookbookGrid items={coCreationItems} />
          </>
        )}

        {dropsWithExtras.length === 0 && (
          <div className="empty-state" style={{ marginTop: 48 }}>
            No pieces listed yet. Follow along, new arrivals weekly.
          </div>
        )}

        {/* ─── Pagination ─── */}
        {totalPages > 1 && (
          <div className="pager">
            {page > 1
              ? <Link href={page === 2 ? `/brand/${slug}` : `/brand/${slug}?page=${page - 1}`}>← Prev</Link>
              : <span className="muted">← Prev</span>}
            <span className="count">{page} / {totalPages}</span>
            {page < totalPages
              ? <Link href={`/brand/${slug}?page=${page + 1}`}>Next →</Link>
              : <span className="muted">Next →</span>}
          </div>
        )}
      </div>
    </>
  );
}

function shortAgentSheet(description: string): string {
  if (!description) return '';
  const firstSentence = description.split(/[.!?]\s/)[0];
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.slice(0, 79).trimEnd() + '…';
}
