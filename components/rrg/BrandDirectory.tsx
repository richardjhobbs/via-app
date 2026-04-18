'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useEffect, useCallback } from 'react';
import Image from 'next/image';

interface BrandCard {
  slug: string;
  name: string;
  headline: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  productCount?: number;
}

export default function BrandDirectory({
  brands,
}: {
  brands: BrandCard[];
  selected?: string;
}) {
  const router = useRouter();
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
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir: 'up' | 'down') => {
    scrollRef.current?.scrollBy({ top: dir === 'up' ? -200 : 200, behavior: 'smooth' });
  };

  const handleClick = (slug: string) => {
    router.push(`/brand/${slug}`);
  };

  const BrandCard = ({ b, bannerH = 'h-32' }: { b: BrandCard; bannerH?: string }) => (
    <button
      onClick={() => handleClick(b.slug)}
      className="block w-full border border-white/10 rounded-lg overflow-hidden hover:border-green-500/40 transition-all cursor-pointer text-left"
    >
      <div className={`relative w-full ${bannerH} bg-white/5`}>
        {b.bannerUrl ? (
          <Image src={b.bannerUrl} alt={b.name} fill className="object-cover" unoptimized />
        ) : b.logoUrl ? (
          <div className="w-full h-full flex items-center justify-center">
            <Image src={b.logoUrl} alt={b.name} width={64} height={64} className="object-contain opacity-60" unoptimized />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-2xl font-mono text-white/20 uppercase">{b.name.slice(0, 2)}</span>
          </div>
        )}
      </div>
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold truncate">{b.name}</h3>
          {b.headline && <p className="text-xs text-white/50 truncate mt-0.5">{b.headline}</p>}
        </div>
        {(b.productCount ?? 0) > 0 && (
          <span className="text-xs font-mono text-white/40 shrink-0 mt-0.5">
            {b.productCount} {b.productCount === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>
    </button>
  );

  return (
    <div className="relative group">
      {/* Up arrow */}
      {canScrollUp && (
        <button
          onClick={() => scroll('up')}
          className="absolute top-2 left-1/2 -translate-x-1/2 z-10 w-10 h-10 flex items-center justify-center bg-black/80 border border-white/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:border-green-500/50"
          aria-label="Scroll up"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
      )}

      {/* Desktop: 2-column grid */}
      <div ref={scrollRef} className="hidden sm:grid grid-cols-2 gap-4 max-h-[1000px] overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {brands.map((b) => <BrandCard key={b.slug} b={b} />)}
      </div>

      {/* Down arrow */}
      {canScrollDown && (
        <button
          onClick={() => scroll('down')}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 w-10 h-10 flex items-center justify-center bg-black/80 border border-white/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:border-green-500/50"
          aria-label="Scroll down"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      )}

      {/* Mobile: 1-column */}
      <div className="sm:hidden space-y-3">
        {brands.map((b) => <BrandCard key={b.slug} b={b} bannerH="h-24" />)}
      </div>
    </div>
  );
}
