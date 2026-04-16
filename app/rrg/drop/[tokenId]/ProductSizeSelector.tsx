'use client';

import { useState, useEffect } from 'react';

export interface ProductVariant {
  size: string | null;
  color: string | null;
  inStock: boolean;
  stock: number;
}

interface Props {
  variants: ProductVariant[];
  initialSize?: string;
  onSizeChange?: (size: string | null) => void;
}

/**
 * Size selector on the drop detail page. Reads initial size from URL query param
 * (`?size=M`) when the user arrives from the brand storefront with a pre-selection.
 * Persists to URL without reloading so the selection survives navigation.
 */
export default function ProductSizeSelector({
  variants,
  initialSize,
  onSizeChange,
}: Props) {
  // Dedupe variants by size, prefer in-stock
  const sizeMap = new Map<string, { inStock: boolean; stock: number }>();
  for (const v of variants) {
    if (!v.size) continue;
    const existing = sizeMap.get(v.size);
    if (!existing || (v.inStock && !existing.inStock)) {
      sizeMap.set(v.size, { inStock: v.inStock, stock: v.stock });
    }
  }
  const sizes = Array.from(sizeMap.entries());

  // Validate initialSize — only accept if it exists AND is in stock
  const validInitial = initialSize && sizeMap.get(initialSize)?.inStock ? initialSize : null;
  const [selected, setSelected] = useState<string | null>(validInitial);

  useEffect(() => {
    // Sync selected size to URL query param for sharing / back navigation
    if (selected && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('size', selected);
      window.history.replaceState({}, '', url.toString());
    }
    onSizeChange?.(selected);
  }, [selected, onSizeChange]);

  if (sizes.length === 0) return null;

  return (
    <div className="mt-6 pb-6 border-b border-white/10">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/60">
          Select size
        </p>
        {selected && (
          <span className="text-xs font-mono text-green-400">
            {selected} selected
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {sizes.map(([size, { inStock, stock }]) => (
          <button
            key={size}
            type="button"
            onClick={() => inStock && setSelected(selected === size ? null : size)}
            disabled={!inStock}
            className={[
              'px-4 py-2 text-sm font-mono rounded border transition-all min-w-[3rem]',
              inStock
                ? selected === size
                  ? 'border-green-500 bg-green-500/20 text-green-400'
                  : 'border-white/25 text-white hover:border-white/50 hover:bg-white/5'
                : 'border-white/5 text-white/20 line-through cursor-not-allowed bg-white/[0.02]',
            ].join(' ')}
            title={inStock ? `${size} — ${stock} in stock` : `${size} — out of stock`}
          >
            {size}
          </button>
        ))}
      </div>
      {!selected && (
        <p className="text-xs font-mono text-white/40 mt-3">
          Choose a size to continue
        </p>
      )}
    </div>
  );
}
