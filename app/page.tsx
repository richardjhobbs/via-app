import Link from 'next/link';
import {
  getApprovedDropsPaginated,
  getPurchaseCountsByTokenIds,
  getBrandsForDirectory,
  getOpenBriefs,
  getAllActiveBrands,
} from '@/lib/rrg/db';
import { getSignedUrlsBatch } from '@/lib/rrg/storage';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';
import ShopWithAI from '@/components/rrg/ShopWithAI';

export const dynamic = 'force-dynamic';

const FALLBACK_HERO = '/design/maison/alaia-dress-1.jpg';
const FALLBACK_BRAND_IMAGES = [
  '/design/maison/jpg-jeans-1.jpg',
  '/design/maison/cartier-ring-1.jpg',
  '/design/maison/rrl-jacket-1.jpg',
  '/design/maison/lv-ursula-1.jpg',
  '/design/maison/alaia-dress-2.jpg',
  '/design/maison/jpg-jeans-3.jpg',
  '/design/maison/cartier-ring-2.jpg',
  '/design/maison/rrl-jacket-3.jpg',
  '/design/maison/lv-ursula-2.jpg',
];

export default async function Landing() {
  // ─── Data ────────────────────────────────────────────────────────────
  const [directoryBrands, allBrands, openBriefs, { drops: dropsPool }] = await Promise.all([
    getBrandsForDirectory(),
    getAllActiveBrands(),
    getOpenBriefs(),
    getApprovedDropsPaginated(1, 60),
  ]);

  // The RRG house brand is excluded from § 01 brand cards and § 03 lookbook —
  // this landing page is the RRG surface itself, so its own imagery shouldn't
  // populate the "admitted brands" grid or the lookbook.
  const rrgBrandIds = new Set(allBrands.filter(b => b.slug === 'rrg').map(b => b.id));

  // Sort brands: most products first, then recency. Ensures feature card has content.
  const sortedBrands = [...directoryBrands]
    .filter(b => !rrgBrandIds.has(b.id))
    .sort((a, b) => {
      if (b.product_count !== a.product_count) return b.product_count - a.product_count;
      return b.created_at.localeCompare(a.created_at);
    });

  const filteredDropsPool = dropsPool.filter(d => !d.brand_id || !rrgBrandIds.has(d.brand_id));

  const totalBrands = allBrands.length;
  // Storefront total (curated, ui_visible=true) — used in the brand-directory link strip
  // where the count corresponds to what's actually on the grid the link leads to.
  const totalProducts = directoryBrands.reduce((sum, b) => sum + b.product_count, 0);
  // Full MCP catalogue total (every approved + non-hidden product) — used in the
  // "in numbers" trust strip which represents the full agent-discoverable surface.
  const totalMcpProducts = directoryBrands.reduce((sum, b) => sum + b.mcp_product_count, 0);
  const totalOpenBriefs = openBriefs.length;

  // ─── Signed URLs ─────────────────────────────────────────────────────
  const brandPaths = sortedBrands.flatMap(b => [b.banner_path, b.logo_path]).filter((p): p is string => !!p);
  const dropPaths = filteredDropsPool.map(d => d.jpeg_storage_path).filter((p): p is string => !!p);
  const urlMap = await getSignedUrlsBatch([...brandPaths, ...dropPaths]);

  const brandMap = new Map(allBrands.map(b => [b.id, b]));

  // ─── Lookbook (cap one per brand for variety, 8 total) ───────────────
  const tokenIds = filteredDropsPool.map(d => d.token_id).filter((id): id is number => id != null);
  const purchaseCounts = await getPurchaseCountsByTokenIds(tokenIds);

  const seen = new Set<string>();
  const lookbookDrops: typeof filteredDropsPool = [];
  for (const d of filteredDropsPool) {
    const key = d.brand_id ?? '__none__';
    if (seen.has(key)) continue;
    seen.add(key);
    lookbookDrops.push(d);
    if (lookbookDrops.length >= 8) break;
  }
  if (lookbookDrops.length < 8) {
    for (const d of filteredDropsPool) {
      if (lookbookDrops.includes(d)) continue;
      lookbookDrops.push(d);
      if (lookbookDrops.length >= 8) break;
    }
  }

  // Per-brand product image for brand-grid cards. Prefer a drop NOT already shown
  // in the lookbook below, so § 01 and § 03 don't duplicate the same photos.
  const lookbookDropIds = new Set(lookbookDrops.map(d => d.id));
  const brandImage = new Map<string, string>();
  for (const d of filteredDropsPool) {
    if (!d.brand_id || brandImage.has(d.brand_id)) continue;
    if (lookbookDropIds.has(d.id)) continue;
    const u = d.jpeg_storage_path ? urlMap.get(d.jpeg_storage_path) : null;
    if (u) brandImage.set(d.brand_id, u);
  }
  // Fallback: brands with only one drop reuse it rather than show no image.
  for (const d of filteredDropsPool) {
    if (!d.brand_id || brandImage.has(d.brand_id)) continue;
    const u = d.jpeg_storage_path ? urlMap.get(d.jpeg_storage_path) : null;
    if (u) brandImage.set(d.brand_id, u);
  }

  const lookbookItems = lookbookDrops.map((d, i) => {
    const brand = d.brand_id ? brandMap.get(d.brand_id) : null;
    const imageUrl = d.jpeg_storage_path ? (urlMap.get(d.jpeg_storage_path) ?? null) : null;
    const soldOut = d.token_id != null
      ? (purchaseCounts.get(d.token_id) ?? 0) >= d.edition_size
      : false;
    return {
      id: d.id,
      tokenId: d.token_id,
      title: d.title,
      brandName: brand?.name ?? 'Independent',
      price: d.price_usdc ? `$${Number(d.price_usdc).toFixed(0)}` : 'On request',
      imageUrl: imageUrl ?? FALLBACK_BRAND_IMAGES[i % FALLBACK_BRAND_IMAGES.length],
      soldOut,
      detail: shortAgentSheet(d.enhanced_description ?? d.description ?? ''),
    };
  });

  // ─── Hero: a real product image with concierge overlay ───────────────
  // The narrative: this is a piece the concierge surfaced, not an editorial spread.
  const heroDrop = dropsPool[0] ?? null;
  const heroBrand = heroDrop?.brand_id ? brandMap.get(heroDrop.brand_id) : null;
  const heroImage = heroDrop?.jpeg_storage_path
    ? (urlMap.get(heroDrop.jpeg_storage_path) ?? FALLBACK_HERO)
    : FALLBACK_HERO;
  const heroTitle = heroDrop?.title ?? 'Cotton Shirtwaist';
  const heroPrice = heroDrop?.price_usdc ? `$${Number(heroDrop.price_usdc).toFixed(0)}` : '$206';
  const heroBrandName = heroBrand?.name ?? 'Maison Archive';
  const heroHref = heroDrop?.token_id != null ? `/rrg/drop/${heroDrop.token_id}` : '/rrg';

  // ─── Feature + grid brand cards ──────────────────────────────────────
  // Prefer brands NOT already featured in the § 03 lookbook. Same-brand photos
  // read as "duplicates" even when the products differ, so push lookbook brands
  // to the back of the queue and only include them if we run out of alternatives.
  const lookbookBrandIds = new Set(
    lookbookDrops.map(d => d.brand_id).filter((id): id is string => !!id),
  );
  const brandsForS01 = [...sortedBrands].sort((a, b) => {
    const aInLb = lookbookBrandIds.has(a.id) ? 1 : 0;
    const bInLb = lookbookBrandIds.has(b.id) ? 1 : 0;
    if (aInLb !== bInLb) return aInLb - bInLb;
    if (b.product_count !== a.product_count) return b.product_count - a.product_count;
    return b.created_at.localeCompare(a.created_at);
  });
  const feature = brandsForS01[0];
  const gridBrands = brandsForS01.slice(1, 11);
  const tallBrand = gridBrands[2]; // 3rd grid slot becomes tall feature

  function brandCardImage(brandId: string, bannerPath: string | null, fallbackIdx: number): string {
    // Prefer latest product image (reliable aspect), fall back to banner, then static.
    return (
      brandImage.get(brandId) ??
      (bannerPath ? urlMap.get(bannerPath) ?? null : null) ??
      FALLBACK_BRAND_IMAGES[fallbackIdx % FALLBACK_BRAND_IMAGES.length]
    );
  }

  return (
    <>
      <RRGHeader active="store" showMarquee />

      {/* ─── HERO ──────────────────────────────────────────────────────── */}
      <div className="hero">
        <div className="hero-left">
          <div>
            <div className="hero-eyebrow"><span className="bullet"></span><span className="uc-mono">Vol. I, your concierge</span></div>
            <h1 className="hero-title">A private eye<br/>for the <em>pieces</em><br/>worth <em>finding.</em></h1>
            <p className="hero-sub">
              A quiet assistant that knows your taste, your wardrobe and the brands you return to.
              Say what you are looking for. Let it search, evaluate, and bring only what is worth your attention.
            </p>
            <div className="hero-cta">
              <Link className="btn" href="/agents">Meet your concierge <span className="arrow">→</span></Link>
              <Link className="btn ghost" href="/rrg">Browse the store</Link>
            </div>
          </div>

          <div className="hero-meta">
            <div>
              <h4>For Collectors</h4>
              <p>Briefed with your taste, dispatched against every new listing, every week. Approvals, not recommendations.</p>
            </div>
            <div>
              <h4>For Brands</h4>
              <p>An attentive audience. Co-creation with vetted creators. Agent-ready listings, by default.</p>
            </div>
          </div>
        </div>

        {/* Hero cover: product image framed as concierge find */}
        <Link href={heroHref} className="cover" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="cover-image" style={{ backgroundImage: `url('${heroImage}')`, backgroundPosition: 'center', backgroundSize: 'cover' }}></div>
          <div className="cover-overlay"></div>
          <div className="cover-tag">Surfaced by your concierge</div>
          <div className="cover-masthead">Real<br/>Real<br/>Genuine<br/>N°04 · 04.2026</div>
          <div className="cover-caption">
            <div className="kicker">A piece found for a brief</div>
            <h2>{heroTitle}</h2>
            <p>{heroBrandName}, {heroPrice}. Shortlisted against a quiet, considered brief.</p>
          </div>

          <div className="concierge-card">
            <div className="cc-head">
              <div className="cc-avatar"></div>
              <div>
                <div className="cc-name">The Concierge</div>
                <div className="cc-status"><span className="live"></span>Listening, {totalBrands} brands</div>
              </div>
            </div>
            <div className="cc-body">&ldquo;Quiet, considered. Under $400.&rdquo;</div>
            <div className="cc-foot">
              <span>Shortlist of 1</span>
              <span className="accent">› review</span>
            </div>
          </div>
        </Link>
      </div>

      {/* ─── BRANDS ────────────────────────────────────────────────────── */}
      <section id="brands" className="maison-section">
        <div className="section-head">
          <div>
            <div className="section-note">§ 01, the brands</div>
            <h3>Admitted to the store.</h3>
          </div>
          <div className="sh-right">
            <span>{totalBrands} brands, {totalProducts.toLocaleString()} products</span>
            <Link href="/brand">View directory →</Link>
          </div>
        </div>

        <div className="brands-grid">
          {/* Feature card */}
          {feature && (
            <Link className="brand-card feat" href={`/brand/${feature.slug}`}>
              <div
                className="brand-image"
                style={{
                  backgroundImage: `url('${brandCardImage(feature.id, feature.banner_path, 0)}')`,
                  backgroundPosition: 'center',
                }}
              >
                <div className="feat-inner">
                  <div className="feat-overlay"></div>
                  <div className="feat-top">
                    <span className="feat-chip">This week, N°04</span>
                    <span className="feat-chip">Featured</span>
                  </div>
                  <div className="feat-bottom">
                    <div style={{ fontFamily: 'var(--font-jetbrains), JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', marginBottom: 12 }}>
                      Feature, {feature.name}
                    </div>
                    <h4>{feature.headline ? feature.headline : 'A house, curated one piece at a time.'}</h4>
                    <p>Agent-facing product sheets, thoughtful edits, new and archive in rotation.</p>
                    <div className="feat-meta">
                      <span>{feature.mcp_product_count.toLocaleString()} agent-ready</span>
                      <span>{feature.product_count} on storefront</span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Grid cards */}
          {gridBrands.map((b, idx) => {
            const isTall = b === tallBrand;
            const img = brandCardImage(b.id, b.banner_path, idx + 1);

            if (isTall) {
              return (
                <Link key={b.id} className="brand-card tall" href={`/brand/${b.slug}`}>
                  <div className="brand-image" style={{ backgroundImage: `url('${img}')`, backgroundPosition: 'center' }}>
                    <div className="feat-inner">
                      <div className="feat-overlay"></div>
                      <div className="feat-top">
                        <span className="feat-chip">Featured</span>
                      </div>
                      <div className="feat-bottom">
                        <h4 style={{ fontSize: 32 }}>{b.name}</h4>
                        <p>{b.headline ?? 'Continuously updated.'}</p>
                        <div className="feat-meta">
                          <span>{b.mcp_product_count.toLocaleString()} agent-ready</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            }

            return (
              <Link key={b.id} className="brand-card" href={`/brand/${b.slug}`}>
                <div className="brand-image" style={{ backgroundImage: `url('${img}')` }}></div>
                <div className="brand-body">
                  <div>
                    <h4>{b.name}</h4>
                    <p>{b.headline ?? 'Admitted brand'}</p>
                  </div>
                  <span className="count">{b.mcp_product_count.toLocaleString()} agent-ready</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ─── SPREAD: HOW THE CONCIERGE WORKS ──────────────────────────── */}
      <div className="spread">
        <div className="spread-inner">
          <div>
            <div className="section-note">§ 02, your concierge</div>
            <h3>It does the <em>looking</em>,<br/>so you can do the <em>choosing</em>.</h3>
            <p className="lead">
              Brief it once. The concierge reads every new listing against your taste,
              weighs fit, finish and context, then brings you a short, considered
              shortlist. New collections, archive pieces, collaborations. The work is in what it leaves out.
            </p>
            <p className="lead" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
              Every brand publishes an agent-readable product sheet beneath the images:
              brand context, condition detail, buyer-intent signals, styling notes.
              You do not see it unless you want to. Your concierge always does.
            </p>
            <div className="hero-cta" style={{ marginTop: 24 }}>
              <Link className="btn" href="/agents">Brief your concierge <span className="arrow">→</span></Link>
              <Link className="btn ghost" href="/how-it-thinks">How it thinks</Link>
            </div>
          </div>

          <div className="dialog">
            <div className="dialog-head">
              <div className="title"><em style={{ fontStyle: 'italic' }}>Your</em> concierge</div>
              <div style={{ fontFamily: 'var(--font-jetbrains), JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                <span style={{ display: 'inline-block', width: 5, height: 5, background: 'var(--live)', borderRadius: 99, marginRight: 6 }}></span>Session, 18 min
              </div>
            </div>

            <div className="msg msg-you"><div className="bubble">Something considered for the weekend. Nothing flashy. Around {lookbookItems[0]?.price ?? '$200'}.</div></div>
            <div className="msg msg-cc"><div className="bubble">Based on the pieces you have saved, I think this sits right. Clean finish, quiet construction, the kind of thing that wears in.</div></div>

            <div className="finding">
              <div className="finding-img" style={{ backgroundImage: `url('${lookbookItems[0]?.imageUrl ?? FALLBACK_HERO}')` }}></div>
              <div className="finding-body">
                <div className="name">{lookbookItems[0]?.title ?? 'A considered piece'}</div>
                <div className="meta">{lookbookItems[0]?.brandName ?? 'Maison'}, {lookbookItems[0]?.soldOut ? 'last one' : 'available'}</div>
              </div>
              <div className="finding-price">{lookbookItems[0]?.price ?? '$206'}<span className="sub">{lookbookItems[0]?.brandName ?? 'Maison'}</span></div>
            </div>

            <div className="protocol-line">
              <span className="pd"></span>
              <span>Agent-ready, condition verified</span>
              <span style={{ marginLeft: 'auto' }}>Offer held 24h</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── LOOKBOOK ─────────────────────────────────────────────────── */}
      <section className="lookbook maison-section">
        <div className="section-head">
          <div>
            <div className="section-note">§ 03, the lookbook</div>
            <h3>A random selection.</h3>
          </div>
          <div className="sh-right">
            <span>{lookbookItems.length} pieces, refreshed daily</span>
            <Link href="/rrg">Enter the store →</Link>
          </div>
        </div>

        <div className="look-grid">
          {lookbookItems.map(item => {
            const href = item.tokenId != null ? `/rrg/drop/${item.tokenId}` : '/rrg';
            return (
              <Link key={item.id} className="look-item" href={href}>
                <div className="look-image" style={{ backgroundImage: `url('${item.imageUrl}')` }}></div>
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
      </section>

      {/* ─── CO-CREATION ──────────────────────────────────────────────── */}
      <div className="collab" id="cocreators">
        <div className="section-head" style={{ padding: '88px 40px 28px', maxWidth: 1440, margin: '0 auto', border: 'none' }}>
          <div>
            <div className="section-note">§ 04, co-creators</div>
            <h3>Co-creation, quietly.</h3>
          </div>
          <div className="sh-right">
            <Link
              href="/cocreators"
              style={{
                color: 'var(--ink-2)',
                fontSize: 13,
                textDecoration: 'none',
                borderBottom: '1px solid var(--line-strong)',
                paddingBottom: 2,
                letterSpacing: '0.01em',
              }}
            >
              All open briefs ({openBriefs.length}) →
            </Link>
          </div>
        </div>
        <div className="collab-inner">
          {openBriefs.slice(0, 2).map((brief, i) => {
            const brand = brief.brand_id ? brandMap.get(brief.brand_id) : null;
            const deadline = brief.ends_at
              ? new Date(brief.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : 'Rolling';
            return (
              <div key={brief.id} className="collab-card">
                <div className="tag-line">
                  <span className="uc-mono" style={{ color: 'var(--accent)' }}>Open brief, 0{i + 1}</span>
                  <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>Closes {deadline}</span>
                </div>
                <div>
                  <h4>{brand ? <em>{brand.name}</em> : <em>Open brief</em>}<br/>{brief.title}</h4>
                  <p>{truncate(brief.description, 180)}</p>
                </div>
                <div className="c-cta">
                  <Link href={brand ? `/brand/${brand.slug}` : '/rrg'}>Read the brief →</Link>
                  <span className="deadline">{brief.response_count} creators responding</span>
                </div>
              </div>
            );
          })}

          {openBriefs.length === 0 && (
            <>
              <div className="collab-card">
                <div className="tag-line">
                  <span className="uc-mono" style={{ color: 'var(--accent)' }}>Becoming a co-creator</span>
                  <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>Open</span>
                </div>
                <div>
                  <h4>Apply <em>as a creator.</em></h4>
                  <p>Approved co-creators get first look at every open brief. Your work can become a limited edition, on-chain, with revenue shared automatically.</p>
                </div>
                <div className="c-cta">
                  <Link href="/creator">Apply to co-create →</Link>
                  <span className="deadline">Rolling admissions</span>
                </div>
              </div>
              <div className="collab-card">
                <div className="tag-line">
                  <span className="uc-mono" style={{ color: 'var(--accent)' }}>Launching a brief</span>
                  <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>For brands</span>
                </div>
                <div>
                  <h4><em>For brands,</em> a creative channel.</h4>
                  <p>Admitted brands can run creator briefs directly. Approved work becomes a limited edition tied to the brand, with revenue split automatically.</p>
                </div>
                <div className="c-cta">
                  <Link href="/create" className="highlight" style={{ color: 'var(--accent)' }}>Apply as a brand →</Link>
                  <span className="deadline">Now admitting</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── CONNECTORS ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 96 }}>
        <ShopWithAI />
      </div>

      {/* ─── TRUST STRIP ──────────────────────────────────────────────── */}
      <div className="trust">
        <div className="trust-head">
          <div>
            <div className="section-note">§ 05, real real genuine, in numbers</div>
            <h3>Quietly <em>accountable.</em></h3>
          </div>
        </div>
        <div className="trust-grid">
          <div className="trust-cell">
            <div className="big">{totalBrands}</div>
            <div className="lbl">Admitted brands</div>
            <div className="desc">Heritage labels, independent studios and curators. Vetted, not open to list.</div>
          </div>
          <div className="trust-cell">
            <div className="big">{totalMcpProducts.toLocaleString()}</div>
            <div className="lbl">Products listed</div>
            <div className="desc">New collections, archive pieces, fine jewellery. Refreshed daily across every admitted brand.</div>
          </div>
          <div className="trust-cell">
            <div className="big">{String(totalOpenBriefs).padStart(2, '0')}</div>
            <div className="lbl">Open co-creator briefs</div>
            <div className="desc">Live creative briefs from admitted brands. Approved work becomes a limited edition, on-chain, revenue shared.</div>
          </div>
          <a
            href="https://8004scan.io/agents/base/33313"
            target="_blank"
            rel="noopener noreferrer"
            className="trust-cell trust-cell-link"
          >
            <div className="big"><em>#33313</em></div>
            <div className="lbl">RRG reference, ERC-8004 ↗</div>
            <div className="desc">Our registry identity on Base mainnet. View on 8004scan, the public agent registry.</div>
          </a>
        </div>
      </div>

      <RRGFooter />
    </>
  );
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function shortAgentSheet(description: string): string {
  if (!description) return '';
  const firstSentence = description.split(/[.!?]\s/)[0];
  return truncate(firstSentence, 80);
}
