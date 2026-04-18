import {
  getApprovedDropsPaginated,
  getPurchaseCountsByTokenIds,
  getAllActiveBrands,
  getBrandsForDirectory,
} from '@/lib/rrg/db';
import { getSignedUrlsBatch } from '@/lib/rrg/storage';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PER_PAGE = 48;

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; brand?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const brandSlug = params.brand && params.brand !== 'all' ? params.brand : null;

  const [allBrands, directoryBrands] = await Promise.all([
    getAllActiveBrands(),
    getBrandsForDirectory(),
  ]);

  const selectedBrand = brandSlug ? allBrands.find(b => b.slug === brandSlug) : null;
  const { drops, totalCount } = await getApprovedDropsPaginated(
    page,
    PER_PAGE,
    undefined,
    selectedBrand?.id,
  );

  const tokenIds = drops.map(d => d.token_id).filter((id): id is number => id != null);
  const [purchaseCounts, urlMap] = await Promise.all([
    getPurchaseCountsByTokenIds(tokenIds),
    getSignedUrlsBatch(drops.map(d => d.jpeg_storage_path).filter((p): p is string => !!p)),
  ]);

  const brandMap = new Map(allBrands.map(b => [b.id, b]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

  const dropsWithUrls = drops.map(d => {
    const brand = d.brand_id ? brandMap.get(d.brand_id) : null;
    const imageUrl = d.jpeg_storage_path ? urlMap.get(d.jpeg_storage_path) ?? null : null;
    const soldOut = d.token_id != null
      ? (purchaseCounts.get(d.token_id) ?? 0) >= d.edition_size
      : false;
    return {
      id: d.id,
      tokenId: d.token_id,
      title: d.title,
      brandName: brand?.name ?? 'Independent',
      price: d.price_usdc ? `$${Number(d.price_usdc).toFixed(0)}` : 'On request',
      imageUrl,
      soldOut,
      detail: shortAgentSheet(d.enhanced_description ?? d.description ?? ''),
    };
  });

  // Top N brands for the filter rail (by product count)
  const filterBrands = [...directoryBrands]
    .sort((a, b) => b.product_count - a.product_count)
    .slice(0, 10);

  const baseHref = (p: number, brand: string | null) => {
    const q: string[] = [];
    if (brand) q.push(`brand=${brand}`);
    if (p > 1) q.push(`page=${p}`);
    return q.length ? `/rrg?${q.join('&')}` : '/rrg';
  };

  return (
    <div className="page-pad" id="brands">
      {/* ─── Section head ─── */}
      <div className="section-head" style={{ borderTop: 'none', marginTop: 0, paddingTop: 24 }}>
        <div>
          <div className="section-note">§ The store</div>
          <h3>{selectedBrand ? <><em>{selectedBrand.name}</em>, the shop.</> : 'Every piece, one place.'}</h3>
        </div>
        <div className="sh-right">
          <span>
            {totalCount.toLocaleString()} {totalCount === 1 ? 'piece' : 'pieces'}
            {selectedBrand ? '' : `, ${allBrands.length} brands`}
          </span>
          {selectedBrand && <Link href="/rrg">Clear filter →</Link>}
        </div>
      </div>

      {/* ─── Brand filter chips ─── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 40 }}>
        <Link href="/rrg" className={`chip ${!selectedBrand ? 'is-active' : ''}`}>
          All <span className="count">{allBrands.length}</span>
        </Link>
        {filterBrands.map(b => (
          <Link
            key={b.id}
            href={`/rrg?brand=${b.slug}`}
            className={`chip ${selectedBrand?.slug === b.slug ? 'is-active' : ''}`}
          >
            {b.name} <span className="count">{b.product_count}</span>
          </Link>
        ))}
        {directoryBrands.length > filterBrands.length && (
          <Link href="/#brands" className="chip">All brands →</Link>
        )}
      </div>

      {/* ─── Lookbook grid ─── */}
      {dropsWithUrls.length > 0 ? (
        <div className="look-grid">
          {dropsWithUrls.map(item => {
            const href = item.tokenId != null ? `/rrg/drop/${item.tokenId}` : '/rrg';
            return (
              <Link key={item.id} className="look-item" href={href}>
                <div
                  className="look-image"
                  style={item.imageUrl ? { backgroundImage: `url('${item.imageUrl}')` } : undefined}
                />
                <h4 className="look-name">{item.title}</h4>
                <p className="look-brand">{item.brandName}</p>
                <div className="look-meta">
                  <span className="price">{item.price}</span>
                  <span>{item.soldOut ? 'Sold out' : 'Available'}</span>
                </div>
                {item.detail && (
                  <div className="agent-reveal">
                    <span className="tag">Agent sheet →</span> {item.detail}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          No pieces match this filter yet. <Link href="/rrg" style={{ color: 'var(--ink-2)', marginLeft: 8, textDecoration: 'underline' }}>See all</Link>
        </div>
      )}

      {/* ─── Pagination ─── */}
      {totalPages > 1 && (
        <div className="pager">
          {page > 1
            ? <Link href={baseHref(page - 1, brandSlug)}>← Prev</Link>
            : <span className="muted">← Prev</span>}
          <span className="count">{page} / {totalPages}</span>
          {page < totalPages
            ? <Link href={baseHref(page + 1, brandSlug)}>Next →</Link>
            : <span className="muted">Next →</span>}
        </div>
      )}
    </div>
  );
}

function shortAgentSheet(description: string): string {
  if (!description) return '';
  const firstSentence = description.split(/[.!?]\s/)[0];
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.slice(0, 79).trimEnd() + '…';
}
