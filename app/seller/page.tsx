import Link from 'next/link';
import type { Metadata } from 'next';
import RRGHeader from '@/components/app/RRGHeader';
import RRGFooter from '@/components/app/RRGFooter';
import {
  getAllActiveBrands,
  getBrandsForDirectory,
  getApprovedDropsPaginated,
} from '@/lib/app/db';
import { getSignedUrlsBatch } from '@/lib/app/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brands, Real Real Genuine',
  description: 'Admitted brands: heritage labels, independent studios, curators and fine jewellery. Each with agent-readable product sheets.',
};

export default async function BrandsDirectoryPage() {
  const [directoryBrands, allBrands, { drops: recentDrops }] = await Promise.all([
    getBrandsForDirectory(),
    getAllActiveBrands(),
    getApprovedDropsPaginated(1, 60),
  ]);

  const brandById = new Map(allBrands.map(b => [b.id, b]));

  // Fallback: first approved product image per brand if no banner
  const fallbackImage = new Map<string, string>();
  for (const d of recentDrops) {
    if (!d.brand_id || fallbackImage.has(d.brand_id)) continue;
    if (d.jpeg_storage_path) fallbackImage.set(d.brand_id, d.jpeg_storage_path);
  }

  const paths = new Set<string>();
  for (const b of directoryBrands) {
    if (b.banner_path) paths.add(b.banner_path);
    if (b.logo_path) paths.add(b.logo_path);
    const fb = fallbackImage.get(b.id);
    if (fb) paths.add(fb);
  }
  const urlMap = await getSignedUrlsBatch([...paths]);

  const sorted = [...directoryBrands].sort((a, b) => {
    if (b.product_count !== a.product_count) return b.product_count - a.product_count;
    return b.created_at.localeCompare(a.created_at);
  });

  const totalProducts    = directoryBrands.reduce((sum, b) => sum + b.product_count,     0);
  const totalMcpProducts = directoryBrands.reduce((sum, b) => sum + b.mcp_product_count, 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="brands" />

      <main>
        {/* ─── Hero ─── */}
        <section className="page-pad" style={{ maxWidth: 1200, paddingTop: 24, paddingBottom: 48 }}>
          <div className="section-note" style={{ marginBottom: 8 }}>§ Brands</div>
          <h1 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"opsz" 144, "wght" 300',
            fontSize: 'clamp(44px, 5.4vw, 80px)',
            letterSpacing: '-0.025em',
            lineHeight: 1.02,
            margin: '0 0 20px',
          }}>
            Admitted to <em>the store.</em>
          </h1>
          <p style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: '62ch', fontWeight: 300, margin: '0 0 20px' }}>
            Heritage labels, independent studios, curators and fine jewellery.
            Each admitted house carries an agent-readable product sheet, so when a concierge
            reads a listing, it reads the context the brand wrote.
          </p>
          <div style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--ink-3)',
            display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span>{allBrands.length} brands</span>
            <span>{totalProducts.toLocaleString()} pieces listed</span>
            {totalMcpProducts > totalProducts && (
              <span title="Storefront grid is curated. The full catalogue is queryable by agents via MCP.">
                {totalMcpProducts.toLocaleString()} in agent catalogue
              </span>
            )}
            <Link href="/create" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>
              Apply as a brand →
            </Link>
          </div>
        </section>

        {/* ─── Directory grid ─── */}
        <section className="page-pad" style={{ maxWidth: 1200, paddingTop: 0 }}>
          {sorted.length === 0 ? (
            <div className="empty-state">No brands admitted yet, checking back soon.</div>
          ) : (
            <div className="brand-dir-grid">
              {sorted.map((b) => {
                const banner = b.banner_path ? urlMap.get(b.banner_path) : null;
                const logo = b.logo_path ? urlMap.get(b.logo_path) : null;
                const fb = fallbackImage.get(b.id);
                const fbUrl = fb ? urlMap.get(fb) : null;
                const image = banner ?? fbUrl ?? null;
                const brand = brandById.get(b.id);
                const description = cleanDescription(brand?.description ?? '');
                const headline = b.headline ? cleanDescription(b.headline) : null;

                return (
                  <Link key={b.id} href={`/brand/${b.slug}`} className="brand-dir-card">
                    <div className="brand-dir-image-wrap">
                      {image ? (
                        <img src={image} alt={b.name} />
                      ) : (
                        <div className="brand-dir-placeholder">{b.name.slice(0, 1)}</div>
                      )}
                      {logo && (
                        <div className="brand-dir-logo-overlay">
                          <img src={logo} alt={`${b.name} logo`} />
                        </div>
                      )}
                    </div>

                    <div className="brand-dir-body">
                      <h2 className="brand-dir-name">{b.name}</h2>
                      {headline && (
                        <p className="brand-dir-headline">{headline}</p>
                      )}
                      {description && description !== headline && (
                        <p className="brand-dir-desc">{truncate(description, 280)}</p>
                      )}
                      <div
                        className="brand-dir-count"
                        style={{
                          fontFamily: 'var(--font-jetbrains), monospace',
                          fontSize: 11,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-3)',
                          marginTop: 10,
                        }}
                        title="Total items agents can query via MCP. The storefront grid above shows the curated subset for humans."
                      >
                        {b.mcp_product_count.toLocaleString()} agent-ready
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ─── Apply CTA ─── */}
        <section className="page-pad" style={{ maxWidth: 1200, paddingTop: 72, paddingBottom: 80 }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 32,
            alignItems: 'flex-end', justifyContent: 'space-between',
            borderTop: '1px solid var(--line)', paddingTop: 48,
          }}>
            <div>
              <div className="section-note" style={{ marginBottom: 8 }}>§ Trade</div>
              <h2 style={{
                fontFamily: 'var(--font-fraunces), serif',
                fontSize: 'clamp(28px, 3.2vw, 42px)',
                fontWeight: 300, letterSpacing: '-0.02em',
                lineHeight: 1.1, margin: '0 0 10px',
              }}>
                Want to be here?
              </h2>
              <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: '50ch', fontWeight: 300, margin: 0 }}>
                RRG is vetted, not open to list. If the brand fits, we would love to hear from you.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href="/create" className="btn accent">
                Apply as a brand <span className="arrow">→</span>
              </Link>
              <Link href="/rrg" className="btn ghost">Browse the store</Link>
            </div>
          </div>
        </section>
      </main>

      <RRGFooter />
    </div>
  );
}

/** Replace em/en dashes (our content style uses commas) and collapse whitespace. */
function cleanDescription(s: string): string {
  return s.replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim();
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
