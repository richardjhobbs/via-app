'use client';

import { useState } from 'react';
import ProductSizeSelector, { type ProductVariant } from './ProductSizeSelector';
import PurchaseFlow from './PurchaseFlow';

interface Props {
  tokenId: number;
  priceUsdc: number;
  soldOut: boolean;
  active: boolean;
  isPhysicalProduct?: boolean;
  shippingType?: string | null;
  variants: ProductVariant[];
  initialSize?: string;
  requireSize: boolean;
}

/**
 * Wraps the size selector + PurchaseFlow so selected size can block the
 * purchase CTA until a size is chosen (when requireSize is true).
 */
export default function PurchaseBlock({
  tokenId,
  priceUsdc,
  soldOut,
  active,
  isPhysicalProduct,
  shippingType,
  variants,
  initialSize,
  requireSize,
}: Props) {
  const [selectedSize, setSelectedSize] = useState<string | null>(initialSize ?? null);

  // If size is required but not selected, block the purchase flow
  const purchaseBlocked = requireSize && !selectedSize;

  return (
    <div>
      {variants.length > 0 && (
        <ProductSizeSelector
          variants={variants}
          initialSize={initialSize}
          onSizeChange={setSelectedSize}
        />
      )}

      {purchaseBlocked ? (
        <div className="mt-6 p-4 border border-white/10 bg-white/5 rounded">
          <p className="text-sm font-mono text-white/70 text-center">
            Select a size above to continue
          </p>
        </div>
      ) : (
        <PurchaseFlow
          tokenId={tokenId}
          priceUsdc={priceUsdc}
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
