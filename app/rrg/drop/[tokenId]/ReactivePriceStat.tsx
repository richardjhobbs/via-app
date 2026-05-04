'use client';

import { useSelectedSize } from './SelectedSizeContext';

/**
 * Renders the Price stat card in the pdp-stats strip. Reads the
 * selected variant from context so the displayed price swaps when a
 * size and/or colour is picked. When nothing is selected and variants
 * carry per-variant overrides, shows the minimum available price
 * labeled "From $X".
 */
export default function ReactivePriceStat() {
  const { variants, basePriceUsdc, selectedSize, selectedColor, effectivePrice } = useSelectedSize();

  const availablePrices = variants
    .filter(v => v.inStock)
    .map(v => v.priceOverride ?? basePriceUsdc);
  const hasSpread = new Set(availablePrices).size > 1;
  const minAvailable = availablePrices.length > 0 ? Math.min(...availablePrices) : basePriceUsdc;

  const hasSelection = !!selectedSize || !!selectedColor;
  const showRange = !hasSelection && hasSpread;
  const displayPrice = hasSelection ? effectivePrice : (showRange ? minAvailable : basePriceUsdc);
  const label = showRange ? 'From' : 'Price';

  const subParts: string[] = ['USDC'];
  if (selectedSize)  subParts.push(`size ${selectedSize}`);
  if (selectedColor) subParts.push(selectedColor);
  const sub = subParts.join(' · ');

  return (
    <div>
      <div className="pdp-stat-lbl">{label}</div>
      <div className="pdp-stat-val">${displayPrice < 1 ? displayPrice.toFixed(2) : Math.round(displayPrice).toLocaleString()}</div>
      <div className="pdp-stat-sub">{sub}</div>
    </div>
  );
}
