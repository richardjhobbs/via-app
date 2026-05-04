'use client';

/**
 * Single source of truth for the selected variant on a drop page.
 *
 * Two axes are supported: size and colour. Either may be present on its
 * own, both may be present (size+colour matrix, e.g. UU garments), or
 * neither (single-variant catalogues). The selectors, the price stat
 * and the buy button all live in different spots in the right column
 * but need to reflect the same selection. A tiny context avoids having
 * to lift the entire right column into one giant client component —
 * page.tsx stays a server component, we just wrap the reactive region
 * with SelectedSizeProvider (kept name for backward compat).
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface VariantInfo {
  size: string | null;
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
  selectedColor: string | null;
  setSelectedColor: (color: string | null) => void;
  effectivePrice: number;
  selectedInStock: boolean;
}

const Ctx = createContext<SelectedSizeCtx | null>(null);

/**
 * Find the variant that matches the current (size, color) selection.
 * Matching rules:
 *   - if selectedSize is set, the variant's size must equal it
 *   - if selectedColor is set, the variant's color must equal it
 *   - axes that are not selected are not constrained
 *   - returns the first match (variants table is already sort_ordered)
 */
function findVariant(
  variants: VariantInfo[],
  selectedSize: string | null,
  selectedColor: string | null
): VariantInfo | undefined {
  return variants.find(v => {
    if (selectedSize !== null && v.size !== selectedSize) return false;
    if (selectedColor !== null && v.color !== selectedColor) return false;
    return true;
  });
}

export function SelectedSizeProvider({
  variants,
  basePriceUsdc,
  initialSize,
  initialColor,
  children,
}: {
  variants: VariantInfo[];
  basePriceUsdc: number;
  initialSize?: string | null;
  initialColor?: string | null;
  children: ReactNode;
}) {
  // Only accept initial values that exist AND are in stock for at least
  // one variant on that axis (same rule the selectors apply visually).
  const sizeIsValid = !!initialSize && variants.some(v => v.size === initialSize && v.inStock);
  const colorIsValid = !!initialColor && variants.some(v => v.color === initialColor && v.inStock);
  const [selectedSize, setSelectedSize]   = useState<string | null>(sizeIsValid ? initialSize! : null);
  const [selectedColor, setSelectedColor] = useState<string | null>(colorIsValid ? initialColor! : null);

  const current = findVariant(variants, selectedSize, selectedColor);
  const effectivePrice = current?.priceOverride ?? basePriceUsdc;
  const selectedInStock = current?.inStock ?? false;

  // Sync to URL so sharing / back navigation preserves selection.
  const syncUrl = (key: 'size' | 'color', value: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    window.history.replaceState({}, '', url.toString());
  };
  const setSizeAndSync = (size: string | null) => {
    setSelectedSize(size);
    syncUrl('size', size);
  };
  const setColorAndSync = (color: string | null) => {
    setSelectedColor(color);
    syncUrl('color', color);
  };

  return (
    <Ctx.Provider value={{
      variants,
      basePriceUsdc,
      selectedSize,
      setSelectedSize: setSizeAndSync,
      selectedColor,
      setSelectedColor: setColorAndSync,
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
