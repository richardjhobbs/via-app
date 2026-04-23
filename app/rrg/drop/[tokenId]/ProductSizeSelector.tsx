'use client';

import { useSelectedSize, type VariantInfo } from './SelectedSizeContext';

// Legacy type export so other callers that imported this shape still compile.
export type ProductVariant = VariantInfo;

/**
 * Size selector on the drop detail page. Renders one button per size, each
 * showing the variant's price when it differs from the base price. Out-of-stock
 * sizes are disabled and struck through. Selected size is stored in context so
 * the Price stat and the Buy button react to the same state.
 */
export default function ProductSizeSelector() {
  const { variants, basePriceUsdc, selectedSize, setSelectedSize } = useSelectedSize();

  // Dedupe by size (prefer in-stock entries when duplicates appear).
  const sizeMap = new Map<string, VariantInfo>();
  for (const v of variants) {
    if (!v.size) continue;
    const existing = sizeMap.get(v.size);
    if (!existing || (v.inStock && !existing.inStock)) sizeMap.set(v.size, v);
  }
  const ordered = Array.from(sizeMap.values());
  if (ordered.length === 0) return null;

  const hasOverrides = ordered.some(v => v.priceOverride != null);
  const inStockCount = ordered.filter(v => v.inStock).length;

  return (
    <div className="mt-6 pb-6 border-b border-white/10">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/60">
          Select size
        </p>
        {selectedSize ? (
          <span className="text-xs font-mono text-green-400">{selectedSize} selected</span>
        ) : (
          <span className="text-xs font-mono text-white/40">
            {inStockCount} in stock · {ordered.length - inStockCount} sold out
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
        {ordered.map((v) => {
          const price = v.priceOverride ?? basePriceUsdc;
          const isSelected = selectedSize === v.size;
          const classes = [
            'relative px-2 py-2 text-sm font-mono rounded border transition-all flex flex-col items-center justify-center min-h-[3.25rem]',
            v.inStock
              ? isSelected
                ? 'border-green-500 bg-green-500/20 text-green-400'
                : 'border-white/25 text-white hover:border-white/50 hover:bg-white/5'
              : 'border-white/5 text-white/20 line-through cursor-not-allowed bg-white/[0.02]',
          ].join(' ');

          return (
            <button
              key={v.size}
              type="button"
              onClick={() => v.inStock && setSelectedSize(isSelected ? null : v.size)}
              disabled={!v.inStock}
              className={classes}
              title={v.inStock ? `Size ${v.size} — $${price.toLocaleString()} USDC` : `Size ${v.size} — sold out`}
            >
              <span className="leading-none">{v.size}</span>
              {hasOverrides && (
                <span className={`text-[10px] leading-none mt-1 tabular-nums ${
                  v.inStock ? (isSelected ? 'text-green-300' : 'text-white/50') : 'text-white/20'
                }`}>
                  {v.inStock ? `$${Math.round(price).toLocaleString()}` : 'sold out'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!selectedSize && (
        <p className="text-xs font-mono text-white/40 mt-3">
          Choose a size to continue
        </p>
      )}
    </div>
  );
}
