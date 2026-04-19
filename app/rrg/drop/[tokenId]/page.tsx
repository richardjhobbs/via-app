import React from 'react';
import { getDropByTokenId, getBrandById, getVariantsBySubmissionId, getSizingByCategory, db } from '@/lib/rrg/db';
import { getSignedUrl } from '@/lib/rrg/storage';
import { getRRGReadOnly } from '@/lib/rrg/contract';
import { notFound } from 'next/navigation';
import PurchaseBlock from './PurchaseBlock';
import PhysicalProductButton from './PhysicalProductButton';
import DropBadges from '@/components/rrg/DropBadges';
import Link from 'next/link';

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  percentage_discount: 'Discount',
  fixed_discount: 'Discount',
  free_item: 'Free Item',
  experience: 'Experience',
  custom: 'Perk',
};

export const dynamic = 'force-dynamic';

function renderBio(bio: string): React.ReactNode {
  const combinedRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|https?:\/\/[^\s<>"']+[^\s<>"'.,!?;)]/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = combinedRegex.exec(bio)) !== null) {
    if (match.index > lastIdx) parts.push(bio.slice(lastIdx, match.index));
    if (match[1] && match[2]) {
      parts.push(
        <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer"
           style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line-strong)', textDecoration: 'none' }}>
          {match[1]}
        </a>
      );
    } else {
      parts.push(
        <a key={key++} href={match[0]} target="_blank" rel="noopener noreferrer"
           style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line-strong)', textDecoration: 'none' }}>
          {match[0].replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      );
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < bio.length) parts.push(bio.slice(lastIdx));
  return <>{parts}</>;
}

interface Props {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ size?: string }>;
}

export default async function DropPage({ params, searchParams }: Props) {
  const { tokenId: tokenIdStr } = await params;
  const { size: preSelectedSize } = await searchParams;
  const tokenId = parseInt(tokenIdStr, 10);
  if (isNaN(tokenId)) notFound();

  const drop = await getDropByTokenId(tokenId);
  if (!drop) notFound();

  let imageUrl: string | null = null;
  try {
    if (drop.jpeg_storage_path) imageUrl = await getSignedUrl(drop.jpeg_storage_path, 3600);
  } catch { /* non-fatal */ }

  const physicalImageUrls: string[] = [];
  if (drop.is_physical_product && drop.physical_images_paths) {
    for (const path of drop.physical_images_paths) {
      try { physicalImageUrls.push(await getSignedUrl(path, 3600)); } catch { /* non-fatal */ }
    }
  }

  let voucherTemplate: { title: string; description: string | null; voucher_type: string; voucher_value: Record<string, unknown> | null; terms: string | null; brand_url: string | null; valid_days: number } | null = null;
  if (drop.has_voucher && drop.voucher_template_id) {
    const { data: vt } = await db
      .from('rrg_voucher_templates')
      .select('title, description, voucher_type, voucher_value, terms, brand_url, valid_days')
      .eq('id', drop.voucher_template_id)
      .single();
    voucherTemplate = vt ?? null;
  }

  const brand = drop.brand_id ? await getBrandById(drop.brand_id) : null;
  const backHref = brand?.slug ? `/brand/${brand.slug}` : '/rrg';
  const backLabel = brand?.name ? `← ${brand.name}` : '← Store';

  const isShopifyBacked = !!brand?.shopify_domain;

  // Always fetch variants for Shopify-backed brands so stock calc works for
  // single-variant catalogues too (e.g. MYKLÉ one-size accessories). The
  // supports_sizing flag only gates size-selector UI, not stock reads.
  const rawVariants = (brand?.supports_sizing || isShopifyBacked)
    ? await getVariantsBySubmissionId(drop.id)
    : [];
  const variantsForUI = brand?.supports_sizing
    ? rawVariants.map(v => ({
        size: v.size, color: v.color,
        inStock: v.cached_stock > 0, stock: v.cached_stock,
      }))
    : [];

  let onChain = { minted: 0, maxSupply: drop.edition_size ?? 0, active: true, soldOut: false };

  if (isShopifyBacked) {
    const totalStock = rawVariants.reduce((sum, v) => sum + Math.max(0, v.cached_stock), 0);
    onChain = { minted: 0, maxSupply: totalStock, active: true, soldOut: totalStock === 0 };
  } else {
    try {
      const contract = getRRGReadOnly();
      const data = await contract.getDrop(tokenId);
      const chainMaxSupply = Number(data.maxSupply);
      if (chainMaxSupply > 0) {
        onChain = {
          minted: Number(data.minted),
          maxSupply: chainMaxSupply,
          active: Boolean(data.active),
          soldOut: Number(data.minted) >= chainMaxSupply,
        };
      }
    } catch { /* non-fatal */ }
  }

  const remaining = isShopifyBacked ? onChain.maxSupply : (onChain.maxSupply - onChain.minted);
  const priceUsdc = parseFloat(drop.price_usdc || '0');
  const scanBase = 'https://basescan.org';

  const sizingChart = (brand?.supports_sizing && drop.sizing_category && brand.id)
    ? await getSizingByCategory(brand.id, drop.sizing_category)
    : null;
  const availableSizesForChart = Array.from(new Set(
    variantsForUI.map(v => v.size).filter((s): s is string => !!s)
  ));

  const shareLabel = drop.is_brand_product
    ? null
    : '35% of purchase price goes to the creator';

  const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;
  const authStatus = typeof attrs.authentication_status === 'string' ? attrs.authentication_status : null;
  const hasAgent = !!drop.enhanced_description;
  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const styleTags = toStringArray(attrs.style_tags);
  const occasionFit = toStringArray(attrs.occasion_fit);

  return (
    <div className="page-pad" style={{ maxWidth: 1200 }}>
      <Link href={backHref} className="pdp-back">{backLabel}</Link>

      <div className="pdp-grid">
        {/* ─── Image ─── */}
        <div className="pdp-image-wrap">
          {imageUrl ? (
            <img src={imageUrl} alt={drop.title} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13 }}>
              #{tokenId}
            </div>
          )}
          {drop.is_physical_product && (
            <span className="pdp-badge" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
              Includes physical piece
            </span>
          )}
        </div>

        {/* ─── Details ─── */}
        <div>
          <p className="pdp-meta">Item #{tokenId}</p>
          <h1 className="pdp-title">{drop.title}</h1>

          {brand && (
            <p className="pdp-brandline">
              From <Link href={`/brand/${brand.slug}`}>{brand.name}</Link>
            </p>
          )}

          {(hasAgent || authStatus) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {hasAgent && (
                <span className="feat-chip" style={{ color: 'var(--accent)', background: 'transparent', border: '1px solid var(--accent)', backdropFilter: 'none' }}>
                  Agent-ready
                </span>
              )}
              {authStatus && (
                <span className="feat-chip" style={{ color: 'var(--ink-2)', background: 'transparent', border: '1px solid var(--line-strong)', backdropFilter: 'none' }}>
                  {authStatus}
                </span>
              )}
            </div>
          )}

          {drop.description && (
            <p className="pdp-desc">
              {drop.description.replace(/\n?\[Suggested:[^\]]*\]/g, '').trim()}
            </p>
          )}

          {/* Agent context panel */}
          {hasAgent && (
            <div className="pdp-agent">
              <div className="pdp-agent-head">
                <span className="tag">Agent context</span>
                <span className="sub">What an AI buyer's agent reads</span>
              </div>
              <p>{drop.enhanced_description}</p>
              {(styleTags.length > 0 || occasionFit.length > 0) && (
                <div className="pdp-agent-tags">
                  {styleTags.map(tag => <span key={tag}>{tag}</span>)}
                  {occasionFit.map(o => <span key={o} className="accent">{o}</span>)}
                </div>
              )}
            </div>
          )}

          {/* Physical product details */}
          {drop.is_physical_product && (
            <div style={{ marginBottom: 24 }}>
              <PhysicalProductButton
                details={{
                  physicalDescription: drop.physical_description,
                  physicalImageUrls,
                  priceIncludesTax: drop.price_includes_tax,
                  priceIncludesPacking: drop.price_includes_packing,
                  ecommerceUrl: drop.ecommerce_url,
                  shippingType: drop.shipping_type,
                  shippingIncludedRegions: drop.shipping_included_regions,
                  refundCommitment: drop.refund_commitment,
                  collectionInPerson: drop.collection_in_person,
                  sizeChart: (sizingChart && availableSizesForChart.length > 0 && brand) ? {
                    chart: sizingChart.size_chart as Array<{ size: string; [key: string]: string | number | undefined }>,
                    unit: sizingChart.unit,
                    fitNotes: sizingChart.fit_notes,
                    brandName: brand.name,
                    category: sizingChart.category,
                    availableSizes: availableSizesForChart,
                  } : null,
                }}
              />
            </div>
          )}

          {/* Voucher perk */}
          {voucherTemplate && (
            <div style={{ margin: '0 0 24px', padding: 20, background: 'var(--bg-2)', border: '1px solid var(--line)', borderLeft: '3px solid var(--accent)' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 6px' }}>
                Includes {VOUCHER_TYPE_LABELS[voucherTemplate.voucher_type] || 'Perk'}
              </p>
              <p style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 18, fontWeight: 400, margin: '0 0 6px' }}>{voucherTemplate.title}</p>
              {voucherTemplate.description && (
                <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 6px', lineHeight: 1.55 }}>{voucherTemplate.description}</p>
              )}
              {voucherTemplate.voucher_value && (
                <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: 'var(--ink-2)', margin: '0 0 6px' }}>
                  {voucherTemplate.voucher_value.percent
                    ? `${voucherTemplate.voucher_value.percent}% off`
                    : voucherTemplate.voucher_value.amount
                    ? `$${voucherTemplate.voucher_value.amount} off`
                    : voucherTemplate.voucher_value.item
                    ? String(voucherTemplate.voucher_value.item)
                    : null}
                </p>
              )}
              {voucherTemplate.terms && (
                <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '6px 0 0' }}>{voucherTemplate.terms}</p>
              )}
              <p style={{ fontSize: 10, color: 'var(--ink-3)', margin: '6px 0 0', fontFamily: 'var(--font-jetbrains), monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Valid {voucherTemplate.valid_days} days after purchase
              </p>
            </div>
          )}

          {/* Stats strip */}
          <div className={`pdp-stats ${isShopifyBacked ? 'two' : ''}`}>
            <div>
              <div className="pdp-stat-lbl">Price</div>
              <div className="pdp-stat-val">${priceUsdc.toFixed(0)}</div>
              <div className="pdp-stat-sub">USDC</div>
            </div>
            {isShopifyBacked ? (
              <div>
                <div className="pdp-stat-lbl">Stock</div>
                <div className={`pdp-stat-val ${remaining === 0 ? 'soldout' : ''}`}>
                  {remaining === 0 ? 'Out of stock' : remaining}
                </div>
                <div className="pdp-stat-sub">across all sizes</div>
              </div>
            ) : (
              <>
                <div>
                  <div className="pdp-stat-lbl">Edition</div>
                  <div className="pdp-stat-val">{onChain.maxSupply}</div>
                  <div className="pdp-stat-sub">total copies</div>
                </div>
                <div>
                  <div className="pdp-stat-lbl">Remaining</div>
                  <div className={`pdp-stat-val ${remaining === 0 ? 'soldout' : ''}`}>{remaining}</div>
                  <div className="pdp-stat-sub">available</div>
                </div>
              </>
            )}
          </div>

          {/* Creator / brand info */}
          {(drop.creator_wallet || drop.creator_bio) && (
            <div style={{ marginBottom: 24 }}>
              {drop.creator_wallet && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                  <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>
                    {drop.is_brand_product ? 'Brand' : 'Creator'}:{' '}
                    <a href={`${scanBase}/address/${drop.creator_wallet}`} target="_blank" rel="noopener noreferrer"
                       style={{ color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--line-strong)' }}>
                      {drop.creator_wallet.slice(0, 6)}…{drop.creator_wallet.slice(-4)}
                    </a>
                  </p>
                  <DropBadges walletAddress={drop.creator_wallet} />
                </div>
              )}
              {drop.creator_bio && (
                <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
                  {renderBio(drop.creator_bio)}
                </p>
              )}
            </div>
          )}

          {/* Purchase block */}
          <PurchaseBlock
            tokenId={tokenId}
            priceUsdc={priceUsdc}
            soldOut={onChain.soldOut}
            active={onChain.active}
            isPhysicalProduct={drop.is_physical_product}
            shippingType={drop.shipping_type}
            variants={variantsForUI}
            initialSize={preSelectedSize}
            requireSize={variantsForUI.length > 0}
          />

          {/* What you get */}
          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
            <p className="pdp-section-head">What you get</p>
            <ul className="pdp-list">
              <li>ERC-1155 token on Base (proof of ownership)</li>
              <li>High-resolution JPEG download</li>
              {drop.additional_files_path && <li>Source files, additional assets</li>}
              {drop.is_physical_product && <li>Physical product shipped by the brand</li>}
              {voucherTemplate && <li>{voucherTemplate.title} (redeemable voucher)</li>}
              {shareLabel && <li>{shareLabel}</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
