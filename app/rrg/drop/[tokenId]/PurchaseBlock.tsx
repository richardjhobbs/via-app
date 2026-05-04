'use client';

import ProductSizeSelector from './ProductSizeSelector';
import ProductColorSelector from './ProductColorSelector';
import PurchaseFlow from './PurchaseFlow';
import { useSelectedSize } from './SelectedSizeContext';

interface Props {
  tokenId: number;
  soldOut: boolean;
  active: boolean;
  isPhysicalProduct?: boolean;
  isBrandProduct?: boolean;
  hasVariants: boolean;
  hasSize: boolean;
  hasColor: boolean;
  requireSize: boolean;
  requireColor: boolean;
}

/**
 * Wires the size and colour selectors + purchase flow to the shared
 * SelectedSizeContext. The effective (per-variant) price is pulled
 * from context and handed to the purchase flow so the "Buy" button
 * reflects the selection and the server charges the right amount.
 *
 * Buy button is gated until every required axis is selected and the
 * matched variant is in stock. Required axes are computed at the
 * server-rendered page level from the variant rows: any variant with
 * size set → requireSize; any variant with colour set → requireColor.
 */
export default function PurchaseBlock({
  tokenId,
  soldOut,
  active,
  isPhysicalProduct,
  isBrandProduct,
  hasVariants,
  hasSize,
  hasColor,
  requireSize,
  requireColor,
}: Props) {
  const { selectedSize, selectedColor, effectivePrice, selectedInStock } = useSelectedSize();

  const sizeMissing  = requireSize  && !selectedSize;
  const colorMissing = requireColor && !selectedColor;
  const variantOutOfStock = hasVariants
    && (!requireSize  || !!selectedSize)
    && (!requireColor || !!selectedColor)
    && !selectedInStock;

  const blockerLabel = (() => {
    if (variantOutOfStock) {
      const parts = [];
      if (selectedSize)  parts.push(`size ${selectedSize}`);
      if (selectedColor) parts.push(selectedColor);
      const combo = parts.join(' / ');
      return `${combo || 'This variant'} is sold out — choose another`;
    }
    if (sizeMissing && colorMissing) return 'Select a size and colour above to continue';
    if (sizeMissing)                  return 'Select a size above to continue';
    if (colorMissing)                 return 'Select a colour above to continue';
    return null;
  })();

  return (
    <div>
      {hasSize  && <ProductSizeSelector />}
      {hasColor && <ProductColorSelector />}

      {blockerLabel ? (
        <div style={{
          marginTop: 24,
          padding: 16,
          border: '1px solid var(--line)',
          background: 'var(--bg-2)',
          textAlign: 'center',
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: 12,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}>
          {blockerLabel}
        </div>
      ) : (
        <PurchaseFlow
          tokenId={tokenId}
          priceUsdc={effectivePrice}
          soldOut={soldOut}
          active={active}
          isPhysicalProduct={isPhysicalProduct}
          isBrandProduct={isBrandProduct}
          selectedSize={selectedSize ?? undefined}
          selectedColor={selectedColor ?? undefined}
        />
      )}
    </div>
  );
}
