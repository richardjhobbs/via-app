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

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
    margin: '0 0 8px',
  };

  const bodyStyle: React.CSSProperties = {
    fontSize: 14,
    color: 'var(--ink-2)',
    lineHeight: 1.6,
    margin: 0,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--ink) 55%, transparent)',
        backdropFilter: 'blur(6px)',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line-strong)',
          width: '100%',
          maxWidth: 640,
          maxHeight: '85vh',
          position: 'relative',
          color: 'var(--ink)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--paper)',
          borderBottom: '1px solid var(--line)',
          padding: '16px 24px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h2 style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--accent)', margin: 0,
          }}>
            Physical product details
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: 4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {canScrollUp && (
          <button
            onClick={() => scroll('up')}
            aria-label="Scroll up"
            style={{
              position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
              zIndex: 20, width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--paper)', border: '1px solid var(--line-strong)', borderRadius: 99,
              cursor: 'pointer', color: 'var(--ink-2)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
        )}

        <div
          ref={scrollRef}
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            maxHeight: 'calc(85vh - 60px)',
            display: 'flex', flexDirection: 'column', gap: 20,
            scrollbarWidth: 'thin',
          }}
        >
          {details.physicalDescription && (
            <div>
              <p style={labelStyle}>Description</p>
              <p style={bodyStyle}>{details.physicalDescription}</p>
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
              <p style={labelStyle}>Product photos</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {details.physicalImageUrls.map((url, i) => (
                  <div key={i} style={{ aspectRatio: '1', background: 'var(--bg-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                    <img src={url} alt={`Product photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p style={labelStyle}>Price includes</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <CheckLine included={details.priceIncludesTax} label="All applicable taxes" />
              <CheckLine included={details.priceIncludesPacking} label="Packing for shipment" />
            </div>
          </div>

          <div>
            <p style={labelStyle}>Shipping</p>
            {details.shippingType === 'included' ? (
              <div>
                <p style={{ ...bodyStyle, marginBottom: 8 }}>Included in price for:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(details.shippingIncludedRegions ?? []).map((region) => (
                    <span key={region} style={{
                      padding: '3px 8px',
                      fontFamily: 'var(--font-jetbrains), monospace',
                      fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                      border: '1px solid var(--accent)', color: 'var(--accent)',
                    }}>
                      {region}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p style={bodyStyle}>
                Shipping cost is calculated based on your delivery address and added to your total at checkout.
              </p>
            )}
          </div>

          {details.collectionInPerson && (
            <div>
              <p style={labelStyle}>Collection in person</p>
              <p style={bodyStyle}>{details.collectionInPerson}</p>
            </div>
          )}

          {details.ecommerceUrl && (
            <div>
              <p style={labelStyle}>Also available at</p>
              <a
                href={details.ecommerceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 12, color: 'var(--ink-2)', textDecoration: 'none',
                  borderBottom: '1px solid var(--line-strong)',
                  paddingBottom: 1, wordBreak: 'break-all',
                }}
              >
                {details.ecommerceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
              </a>
            </div>
          )}

          {details.refundCommitment && (
            <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: 'var(--accent)', fontSize: 14, marginTop: 2 }}>✓</span>
                <p style={bodyStyle}>
                  The brand commits to refunding the buyer if the physical product cannot be
                  shipped or delivered as described.
                </p>
              </div>
            </div>
          )}
        </div>

        {canScrollDown && (
          <button
            onClick={() => scroll('down')}
            aria-label="Scroll down"
            style={{
              position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
              zIndex: 20, width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--paper)', border: '1px solid var(--line-strong)', borderRadius: 99,
              cursor: 'pointer', color: 'var(--ink-2)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

function CheckLine({ included, label }: { included: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: included ? 'var(--accent)' : 'var(--ink-3)', fontSize: 14 }}>
        {included ? '✓' : '✕'}
      </span>
      <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{label}</span>
    </div>
  );
}
