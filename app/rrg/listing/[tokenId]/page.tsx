import React from 'react';
import { getListingByTokenId, getBrandById, getVariantsBySubmissionId, getSizingByCategory, db } from '@/lib/rrg/db';
import ProductSizeChart from '@/components/rrg/ProductSizeChart';
import { getSignedUrl } from '@/lib/rrg/storage';
import { getRRGReadOnly } from '@/lib/rrg/contract';
import { notFound } from 'next/navigation';
import PurchaseBlock from './PurchaseBlock';
import PhysicalProductButton from './PhysicalProductButton';
import ListingBadges from '@/components/rrg/ListingBadges';
import AgentReadyBadge from '@/components/rrg/AgentReadyBadge';
import Link from 'next/link';

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  percentage_discount: 'Discount',
  fixed_discount: 'Discount',
  free_item: 'Free Item',
  experience: 'Experience',
  custom: 'Perk',
};

export const dynamic = 'force-dynamic';

// Render bio with clickable links.
// Supports bare URLs (https://example.com) and markdown links ([My Site](https://example.com)).
function renderBio(bio: string): React.ReactNode {
  // Match [text](url) first, then fall back to bare URLs
  const combinedRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|https?:\/\/[^\s<>"']+[^\s<>"'.,!?;)]/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = combinedRegex.exec(bio)) !== null) {
    if (match.index > lastIdx) {
      parts.push(bio.slice(lastIdx, match.index));
    }
    if (match[1] && match[2]) {
      // Markdown link: [display text](url)
      parts.push(
        <a
          key={key++}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/80 underline underline-offset-2 hover:text-white transition-colors"
        >
          {match[1]}
        </a>
      );
    } else {
      // Bare URL — show domain without protocol
      parts.push(
        <a
          key={key++}
          href={match[0]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/80 underline underline-offset-2 hover:text-white transition-colors"
        >
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

  const drop = await getListingByTokenId(tokenId);
  if (!drop) notFound();

  // Signed image URL
  let imageUrl: string | null = null;
  try {
    if (drop.jpeg_storage_path) {
      imageUrl = await getSignedUrl(drop.jpeg_storage_path, 3600);
    }
  } catch { /* non-fatal */ }

  // Signed URLs for physical product images
  const physicalImageUrls: string[] = [];
  if (drop.is_physical_product && drop.physical_images_paths) {
    for (const path of drop.physical_images_paths) {
      try {
        physicalImageUrls.push(await getSignedUrl(path, 3600));
      } catch { /* non-fatal */ }
    }
  }

  // Voucher template (if product has one attached)
  let voucherTemplate: { title: string; description: string | null; voucher_type: string; voucher_value: Record<string, unknown> | null; terms: string | null; brand_url: string | null; valid_days: number } | null = null;
  if (drop.has_voucher && drop.voucher_template_id) {
    const { data: vt } = await db
      .from('rrg_voucher_templates')
      .select('title, description, voucher_type, voucher_value, terms, brand_url, valid_days')
      .eq('id', drop.voucher_template_id)
      .single();
    voucherTemplate = vt ?? null;
  }

  // Look up brand for back-link + Shopify stock detection
  const brand = drop.brand_id ? await getBrandById(drop.brand_id) : null;
  const backHref  = brand?.slug ? `/brand/${brand.slug}` : '/rrg';
  const backLabel = brand?.name ? `← ${brand.name}` : '← Store';

  // Stock & edition data — two paths:
  // 1. Shopify-backed brands: stock = sum of variant cached_stock (source of truth is Shopify)
  // 2. On-chain drops: stock = maxSupply - minted (source of truth is the contract)
  const isShopifyBacked = !!brand?.shopify_domain;

  // Fetch variants for garment brands (used by size selector + stock display)
  const rawVariants = brand?.supports_sizing ? await getVariantsBySubmissionId(drop.id) : [];
  const variantsForUI = rawVariants.map(v => ({
    size:    v.size,
    color:   v.color,
    inStock: v.cached_stock > 0,
    stock:   v.cached_stock,
  }));

  let onChain = {
    minted:    0,
    maxSupply: drop.edition_size ?? 0,
    active:    true,
    soldOut:   false,
  };

  if (isShopifyBacked) {
    // Shopify-backed: edition = total variant stock, remaining = current variant stock
    const totalStock = rawVariants.reduce((sum, v) => sum + Math.max(0, v.cached_stock), 0);
    onChain = {
      minted:    0,
      maxSupply: totalStock,
      active:    true,  // always active if the product exists
      soldOut:   totalStock === 0,
    };
  } else {
    // On-chain drop: read from contract
    try {
      const contract  = getRRGReadOnly();
      const data      = await contract.getDrop(tokenId);
      const chainMaxSupply = Number(data.maxSupply);
      if (chainMaxSupply > 0) {
        onChain = {
          minted:    Number(data.minted),
          maxSupply: chainMaxSupply,
          active:    Boolean(data.active),
          soldOut:   Number(data.minted) >= chainMaxSupply,
        };
      }
    } catch { /* non-fatal — show DB data */ }
  }

  const remaining  = isShopifyBacked ? onChain.maxSupply : (onChain.maxSupply - onChain.minted);
  const priceUsdc  = parseFloat(drop.price_usdc || '0');
  const scanBase   = 'https://basescan.org';

  // Size chart for garment products — only shown if brand supports sizing
  // AND the product has a sizing_category assigned. Filtered to in-stock sizes.
  const sizingChart = (brand?.supports_sizing && drop.sizing_category && brand.id)
    ? await getSizingByCategory(brand.id, drop.sizing_category)
    : null;
  const availableSizesForChart = Array.from(new Set(
    variantsForUI.map(v => v.size).filter((s): s is string => !!s)
  ));

  // Revenue share display.
  // For brand-owned drops we DO NOT publish the wholesale split — it's
  // a private commercial term between the brand and the platform.
  // Only co-created drops (where a creator earns a known 35% share)
  // surface a share label, since that's part of the creator-facing offer.
  const shareLabel = drop.is_brand_product
    ? null
    : '35% of purchase price goes to the creator';

  return (
    <div className="px-6 py-12 max-w-5xl mx-auto">

      {/* Back */}
      <Link
        href={backHref}
        className="text-sm font-mono text-white/50 hover:text-white transition-colors mb-10 inline-block"
      >
        {backLabel}
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">

        {/* Image — adaptive bg: dark subjects on light, light subjects on dark */}
        <div className={[
          'aspect-square border rounded-lg overflow-hidden md:sticky md:top-8 relative',
          drop.image_is_dark === true
            ? 'bg-white border-white/20'
            : 'bg-white/5 border-white/10',
        ].join(' ')}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={drop.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30 font-mono text-sm">
              #{tokenId}
            </div>
          )}
          {drop.is_physical_product && (
            <span className="absolute top-3 left-3 px-2.5 py-1 bg-lime-500 text-black
                             text-xs font-mono uppercase tracking-wider leading-tight">
              Includes Real Real Product
            </span>
          )}
        </div>

        {/* Details */}
        <div>
          <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/50 mb-3">
            Item #{tokenId}
          </p>
          <h1 className="text-4xl font-light leading-tight mb-4">{drop.title}</h1>

          {/* Agent-readiness + provenance badges (universal — render only when populated) */}
          {(() => {
            const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;
            const authStatus = typeof attrs.authentication_status === 'string' ? attrs.authentication_status : null;
            const hasAgent = !!drop.enhanced_description;
            if (!hasAgent && !authStatus) return null;
            return (
              <div className="flex flex-wrap gap-2 mb-5">
                {hasAgent && <AgentReadyBadge size="md" />}
                {authStatus && <AgentReadyBadge label={authStatus} tone="amber" size="md" />}
              </div>
            );
          })()}

          {drop.description && (
            <p className="text-white/70 text-base leading-relaxed mb-8">
              {drop.description.replace(/\n?\[Suggested:[^\]]*\]/g, '').trim()}
            </p>
          )}

          {/* Agent Context — what an AI buyer's agent actually reads */}
          {drop.enhanced_description && (() => {
            const attrs = (drop.product_attributes ?? {}) as Record<string, unknown>;
            const toStringArray = (v: unknown): string[] =>
              Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
            const styleTags = toStringArray(attrs.style_tags);
            const occasionFit = toStringArray(attrs.occasion_fit);
            return (
              <div className="mb-8 p-5 border border-cyan-400/30 bg-cyan-400/5 rounded-md">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-300/80">
                    Agent Context
                  </span>
                  <span className="text-[10px] font-mono text-cyan-400/40">
                    — what an AI buyer's agent reads
                  </span>
                </div>
                <p className="text-sm text-white/80 leading-relaxed mb-4">
                  {drop.enhanced_description}
                </p>
                {styleTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {styleTags.map((tag) => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 border border-white/15 text-white/60 font-mono uppercase rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {occasionFit.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {occasionFit.map((o) => (
                      <span key={o} className="text-[10px] px-2 py-0.5 border border-cyan-400/20 text-cyan-300/70 font-mono uppercase rounded">
                        {o}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Physical product details button */}
          {drop.is_physical_product && (
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
                  chart:          sizingChart.size_chart as Array<{ size: string; [key: string]: string | number | undefined }>,
                  unit:           sizingChart.unit,
                  fitNotes:       sizingChart.fit_notes,
                  brandName:      brand.name,
                  category:       sizingChart.category,
                  availableSizes: availableSizesForChart,
                } : null,
              }}
            />
          )}

          {/* Voucher perk */}
          {voucherTemplate && (
            <div className="mb-8 p-5 border border-amber-400/30 bg-amber-400/5">
              <p className="text-xs font-mono uppercase tracking-widest text-amber-400/70 mb-2">
                Includes {VOUCHER_TYPE_LABELS[voucherTemplate.voucher_type] || 'Perk'}
              </p>
              <p className="text-lg font-medium mb-1">{voucherTemplate.title}</p>
              {voucherTemplate.description && (
                <p className="text-sm text-white/60 leading-relaxed mb-2">{voucherTemplate.description}</p>
              )}
              {voucherTemplate.voucher_value && (
                <p className="text-sm font-mono text-amber-300/80">
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
                <p className="text-xs text-white/40 mt-2">{voucherTemplate.terms}</p>
              )}
              <p className="text-xs text-white/30 mt-2 font-mono">
                Valid for {voucherTemplate.valid_days} days after purchase
              </p>
            </div>
          )}

          {/* Stats strip */}
          <div className={`grid ${isShopifyBacked ? 'grid-cols-2' : 'grid-cols-3'} gap-4 border-t border-b border-white/10 py-6 mb-8`}>
            <div>
              <p className="text-sm text-white/50 font-mono mb-1">Price</p>
              <p className="text-2xl font-mono">${priceUsdc.toFixed(2)}</p>
              <p className="text-sm text-white/40 mt-0.5">USDC</p>
            </div>
            {isShopifyBacked ? (
              <div>
                <p className="text-sm text-white/50 font-mono mb-1">Stock</p>
                <p className={`text-2xl font-mono ${remaining === 0 ? 'text-red-400' : ''}`}>
                  {remaining === 0 ? 'Out of Stock' : `${remaining} available`}
                </p>
                <p className="text-sm text-white/40 mt-0.5">across all sizes</p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-sm text-white/50 font-mono mb-1">Edition</p>
                  <p className="text-2xl font-mono">{onChain.maxSupply}</p>
                  <p className="text-sm text-white/40 mt-0.5">total copies</p>
                </div>
                <div>
                  <p className="text-sm text-white/50 font-mono mb-1">Remaining</p>
                  <p className={`text-2xl font-mono ${remaining === 0 ? 'text-red-400' : ''}`}>
                    {remaining}
                  </p>
                  <p className="text-sm text-white/40 mt-0.5">available</p>
                </div>
              </>
            )}
          </div>

          {/* Creator / Brand */}
          <div className="mb-8">
            {drop.creator_wallet && (
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <p className="text-sm font-mono text-white/40">
                  {drop.is_brand_product ? 'Brand:' : 'Creator:'}{' '}
                  <a
                    href={`${scanBase}/address/${drop.creator_wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white/70 transition-colors"
                  >
                    {drop.creator_wallet.slice(0, 6)}…{drop.creator_wallet.slice(-4)}
                  </a>
                </p>
                <ListingBadges walletAddress={drop.creator_wallet} />
              </div>
            )}
            {drop.creator_bio && (
              <p className="text-base text-white/60 leading-relaxed">
                {renderBio(drop.creator_bio)}
              </p>
            )}
          </div>

          {/* Size selector + purchase flow (client component) */}
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
          <div className="mt-8 pt-6 border-t border-white/10">
            <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/50 mb-3">
              What you get
            </p>
            <ul className="space-y-2 text-sm text-white/60">
              <li>· ERC-1155 token on Base (proof of ownership)</li>
              <li>· High-resolution JPEG download</li>
              {drop.additional_files_path && <li>· Source files / additional assets</li>}
              {drop.is_physical_product && <li>· Physical product shipped by the brand</li>}
              {voucherTemplate && <li>· {voucherTemplate.title} (redeemable voucher)</li>}
              {shareLabel && <li>· {shareLabel}</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
