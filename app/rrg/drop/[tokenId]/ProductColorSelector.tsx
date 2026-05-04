'use client';

import { useSelectedSize, type VariantInfo } from './SelectedSizeContext';

/**
 * Colour selector on the drop detail page. Renders one button per
 * distinct colour, showing the variant's price when it differs from the
 * base price. Out-of-stock colours are disabled and struck through.
 *
 * When the product also has a size axis, the colour buttons reflect
 * stock for the currently-selected size (so a buyer doesn't pick a
 * colour that isn't available in their size). If no size is selected,
 * the colour is treated as in-stock if ANY size of that colour is in
 * stock.
 */
export default function ProductColorSelector() {
  const { variants, basePriceUsdc, selectedSize, selectedColor, setSelectedColor } = useSelectedSize();

  // Dedupe by colour. When a size is selected, only consider variants
  // matching that size; otherwise consider all variants and treat a
  // colour as in-stock if any size carries it.
  const relevant = selectedSize !== null
    ? variants.filter(v => v.size === selectedSize)
    : variants;
  const colorMap = new Map<string, VariantInfo>();
  for (const v of relevant) {
    if (!v.color) continue;
    const existing = colorMap.get(v.color);
    if (!existing || (v.inStock && !existing.inStock)) colorMap.set(v.color, v);
  }
  const ordered = Array.from(colorMap.values());
  if (ordered.length === 0) return null;

  const hasOverrides = ordered.some(v => v.priceOverride != null);
  const inStockCount = ordered.filter(v => v.inStock).length;

  return (
    <div className="mt-6 pb-6 border-b border-white/10">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/60">
          Select colour
        </p>
        {selectedColor ? (
          <span className="text-xs font-mono text-green-400">{selectedColor} selected</span>
        ) : (
          <span className="text-xs font-mono text-white/40">
            {inStockCount} in stock · {ordered.length - inStockCount} sold out
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {ordered.map((v) => {
          const price = v.priceOverride ?? basePriceUsdc;
          const isSelected = selectedColor === v.color;
          const classes = [
            'relative px-3 py-2 text-sm font-mono rounded border transition-all flex flex-col items-center justify-center min-h-[3.25rem]',
            v.inStock
              ? isSelected
                ? 'border-green-500 bg-green-500/20 text-green-400'
                : 'border-white/25 text-white hover:border-white/50 hover:bg-white/5'
              : 'border-white/5 text-white/20 line-through cursor-not-allowed bg-white/[0.02]',
          ].join(' ');

          return (
            <button
              key={v.color!}
              type="button"
              onClick={() => v.inStock && setSelectedColor(isSelected ? null : v.color)}
              disabled={!v.inStock}
              className={classes}
              title={v.inStock ? `${v.color} — $${price.toLocaleString()} USDC` : `${v.color} — sold out`}
            >
              <span className="leading-none text-center">{v.color}</span>
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

      {!selectedColor && (
        <p className="text-xs font-mono text-white/40 mt-3">
          Choose a colour to continue
        </p>
      )}
    </div>
  );
}
