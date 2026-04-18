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
          Select a size above to continue
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
