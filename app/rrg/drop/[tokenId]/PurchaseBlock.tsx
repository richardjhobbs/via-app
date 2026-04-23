'use client';

import ProductSizeSelector from './ProductSizeSelector';
import PurchaseFlow from './PurchaseFlow';
import { useSelectedSize } from './SelectedSizeContext';

interface Props {
  tokenId: number;
  soldOut: boolean;
  active: boolean;
  isPhysicalProduct?: boolean;
  shippingType?: string | null;
  hasVariants: boolean;
  requireSize: boolean;
}

/**
 * Wires the size selector + purchase flow to the shared SelectedSizeContext.
 * The effective (per-size) price is pulled from context and handed to the
 * purchase flow so the "Buy" button reflects the selection and the server
 * charges the right amount.
 */
export default function PurchaseBlock({
  tokenId,
  soldOut,
  active,
  isPhysicalProduct,
  shippingType,
  hasVariants,
  requireSize,
}: Props) {
  const { selectedSize, effectivePrice, selectedInStock } = useSelectedSize();
  const sizeMissing = requireSize && !selectedSize;
  const sizeOutOfStock = requireSize && !!selectedSize && !selectedInStock;

  return (
    <div>
      {hasVariants && <ProductSizeSelector />}

      {sizeMissing || sizeOutOfStock ? (
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
          {sizeOutOfStock
            ? `Size ${selectedSize} is sold out — choose another size`
            : 'Select a size above to continue'}
        </div>
      ) : (
        <PurchaseFlow
          tokenId={tokenId}
          priceUsdc={effectivePrice}
          soldOut={soldOut}
          active={active}
          isPhysicalProduct={isPhysicalProduct}
          shippingType={shippingType}
          selectedSize={selectedSize ?? undefined}
        />
      )}
    </div>
  );
}
