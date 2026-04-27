'use client';

import { useSelectedSize } from './SelectedSizeContext';

/**
 * Renders the Price stat card in the pdp-stats strip. Reads the selected
 * size from context so the displayed price swaps when a size is picked.
 * When no size is selected and variants carry per-size overrides, shows
 * the minimum available price labeled "From $X".
 */
export default function ReactivePriceStat() {
  const { variants, basePriceUsdc, selectedSize, effectivePrice } = useSelectedSize();

  const availablePrices = variants
    .filter(v => v.inStock)
    .map(v => v.priceOverride ?? basePriceUsdc);
  const hasSpread = new Set(availablePrices).size > 1;
  const minAvailable = availablePrices.length > 0 ? Math.min(...availablePrices) : basePriceUsdc;

  const showRange = !selectedSize && hasSpread;
  const displayPrice = selectedSize ? effectivePrice : (showRange ? minAvailable : basePriceUsdc);
  const label = showRange ? 'From' : 'Price';
  const sub = selectedSize ? `USDC · size ${selectedSize}` : 'USDC';

  return (
    <div>
      <div className="pdp-stat-lbl">{label}</div>
      <div className="pdp-stat-val">${displayPrice < 1 ? displayPrice.toFixed(2) : Math.round(displayPrice).toLocaleString()}</div>
      <div className="pdp-stat-sub">{sub}</div>
    </div>
  );
}
