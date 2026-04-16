'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ProductSizeChart from './ProductSizeChart';

interface SizeChartData {
  chart: Array<{ size: string; [key: string]: string | number | undefined }>;
  unit: string;
  fitNotes: string | null;
  brandName: string;
  category: string;
  availableSizes: string[];
}

interface PhysicalProductModalProps {
  open: boolean;
  onClose: () => void;
  details: {
    physicalDescription: string | null;
    physicalImageUrls: string[];
    priceIncludesTax: boolean;
    priceIncludesPacking: boolean;
    ecommerceUrl: string | null;
    shippingType: string | null;
    shippingIncludedRegions: string[] | null;
    refundCommitment: boolean;
    collectionInPerson: string | null;
    /** Optional per-style size chart (garment products) */
    sizeChart?: SizeChartData | null;
  };
}

export default function PhysicalProductModal({ open, onClose, details }: PhysicalProductModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 10);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 10);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setTimeout(checkScroll, 100);
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [open, checkScroll]);

  if (!open) return null;

  const scroll = (dir: 'up' | 'down') => {
    scrollRef.current?.scrollBy({ top: dir === 'up' ? -200 : 200, behavior: 'smooth' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#111] border border-white/20 rounded-lg w-full max-w-2xl mx-4 max-h-[85vh] relative group"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#111] border-b border-white/10 px-6 py-4 flex justify-between items-center z-10 rounded-t-lg">
          <h2 className="text-sm font-mono uppercase tracking-[0.2em] text-lime-400">
            Physical Product Details
          </h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Up arrow */}
        {canScrollUp && (
          <button
            onClick={() => scroll('up')}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-20 w-10 h-10 flex items-center justify-center bg-black/80 border border-white/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:border-green-500/50"
            aria-label="Scroll up"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
        )}

        {/* Scrollable content */}
        <div ref={scrollRef} className="px-6 py-5 space-y-5 overflow-y-auto max-h-[calc(85vh-60px)]"
             style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {details.physicalDescription && (
            <div>
              <p className="text-sm font-mono text-white/50 mb-1.5">Description</p>
              <p className="text-base text-white/80 leading-relaxed">{details.physicalDescription}</p>
            </div>
          )}

          {details.sizeChart && (
            <ProductSizeChart
              chart={details.sizeChart.chart}
              unit={details.sizeChart.unit}
              fitNotes={details.sizeChart.fitNotes}
              brandName={details.sizeChart.brandName}
              category={details.sizeChart.category}
              availableSizes={details.sizeChart.availableSizes}
            />
          )}

          {details.physicalImageUrls.length > 0 && (
            <div>
              <p className="text-sm font-mono text-white/50 mb-2">Product Photos</p>
              <div className="grid grid-cols-2 gap-2">
                {details.physicalImageUrls.map((url, i) => (
                  <div key={i} className="aspect-square bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <img src={url} alt={`Product photo ${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-mono text-white/50 mb-1.5">Price Includes</p>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${details.priceIncludesTax ? 'text-lime-400' : 'text-white/40'}`}>
                {details.priceIncludesTax ? '\u2713' : '\u2715'}
              </span>
              <span className="text-sm text-white/70">All applicable taxes</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${details.priceIncludesPacking ? 'text-lime-400' : 'text-white/40'}`}>
                {details.priceIncludesPacking ? '\u2713' : '\u2715'}
              </span>
              <span className="text-sm text-white/70">Packing for shipment</span>
            </div>
          </div>

          <div>
            <p className="text-sm font-mono text-white/50 mb-1.5">Shipping</p>
            {details.shippingType === 'included' ? (
              <div>
                <p className="text-sm text-white/70 mb-1">Included in price for:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(details.shippingIncludedRegions ?? []).map((region) => (
                    <span key={region} className="px-2 py-0.5 text-xs font-mono border border-lime-400/20 text-lime-400/70 rounded">
                      {region}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/70">
                Shipping cost is calculated based on your delivery address and added to your total at checkout.
              </p>
            )}
          </div>

          {details.collectionInPerson && (
            <div>
              <p className="text-sm font-mono text-white/50 mb-1.5">Collection in Person</p>
              <p className="text-sm text-white/70">{details.collectionInPerson}</p>
            </div>
          )}

          {details.ecommerceUrl && (
            <div>
              <p className="text-sm font-mono text-white/50 mb-1.5">Also Available At</p>
              <a
                href={details.ecommerceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-white/80 transition-colors font-mono underline block truncate max-w-full"
              >
                {details.ecommerceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')} {'\u2197'}
              </a>
            </div>
          )}

          {details.refundCommitment && (
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-start gap-2">
                <span className="text-lime-400 text-sm mt-0.5">{'\u2713'}</span>
                <p className="text-sm text-white/60 leading-relaxed">
                  The brand commits to refunding the buyer if the physical product cannot be
                  shipped or delivered as described.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Down arrow */}
        {canScrollDown && (
          <button
            onClick={() => scroll('down')}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 w-10 h-10 flex items-center justify-center bg-black/80 border border-white/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:border-green-500/50"
            aria-label="Scroll down"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
