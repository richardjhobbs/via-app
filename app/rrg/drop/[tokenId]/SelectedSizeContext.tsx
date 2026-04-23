'use client';

/**
 * Single source of truth for the selected size on a drop page.
 *
 * The size selector, the price stat, and the buy button all live in
 * different spots in the right column but need to reflect the same
 * selection. A tiny context avoids having to lift the entire right
 * column into one giant client component — page.tsx stays a server
 * component, we just wrap the reactive region with SelectedSizeProvider.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface VariantInfo {
  size: string;
  color: string | null;
  inStock: boolean;
  stock: number;
  priceOverride: number | null;
}

interface SelectedSizeCtx {
  variants: VariantInfo[];
  basePriceUsdc: number;
  selectedSize: string | null;
  setSelectedSize: (size: string | null) => void;
  effectivePrice: number;
  selectedInStock: boolean;
}

const Ctx = createContext<SelectedSizeCtx | null>(null);

export function SelectedSizeProvider({
  variants,
  basePriceUsdc,
  initialSize,
  children,
}: {
  variants: VariantInfo[];
  basePriceUsdc: number;
  initialSize?: string | null;
  children: ReactNode;
}) {
  // Only accept initial if present AND in stock (same rule the selector uses).
  const sizeMap = new Map(variants.map(v => [v.size, v]));
  const validInitial = initialSize && sizeMap.get(initialSize)?.inStock ? initialSize : null;
  const [selectedSize, setSelectedSize] = useState<string | null>(validInitial);

  const current = selectedSize ? sizeMap.get(selectedSize) : undefined;
  const effectivePrice = current?.priceOverride ?? basePriceUsdc;
  const selectedInStock = current?.inStock ?? false;

  // Sync to URL so sharing / back navigation works.
  const setAndSync = (size: string | null) => {
    setSelectedSize(size);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (size) url.searchParams.set('size', size);
      else url.searchParams.delete('size');
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <Ctx.Provider value={{
      variants,
      basePriceUsdc,
      selectedSize,
      setSelectedSize: setAndSync,
      effectivePrice,
      selectedInStock,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSelectedSize() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSelectedSize must be used inside SelectedSizeProvider');
  return ctx;
}
