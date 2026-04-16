'use client';

import { useRouter } from 'next/navigation';

interface Variant {
  size: string | null;
  color: string | null;
  inStock: boolean;
  stock: number;
}

interface SizeSelectorProps {
  variants: Variant[];
  productTitle: string;
  /** Link to the product detail page — size will be appended as ?size= when clicked */
  dropHref: string;
}

/**
 * Brand storefront size chips. Clicking a size navigates to the drop page
 * with the size pre-selected via ?size= URL param.
 */
export default function SizeSelector({ variants, dropHref }: SizeSelectorProps) {
  const router = useRouter();

  // Dedupe sizes (prefer in-stock variant for each size)
  const sizeMap = new Map<string, { inStock: boolean; stock: number }>();
  for (const v of variants) {
    if (!v.size) continue;
    const existing = sizeMap.get(v.size);
    if (!existing || (v.inStock && !existing.inStock)) {
      sizeMap.set(v.size, { inStock: v.inStock, stock: v.stock });
    }
  }

  const sizes = Array.from(sizeMap.entries());
  if (sizes.length === 0) return null;

  const handleSizeClick = (size: string, inStock: boolean) => {
    if (!inStock) return;
    router.push(`${dropHref}?size=${encodeURIComponent(size)}`);
  };

  return (
    <div className="mt-3">
      <p className="text-xs font-mono text-white/50 uppercase tracking-wider mb-2">Size</p>
      <div className="flex flex-wrap gap-1.5">
        {sizes.map(([size, { inStock }]) => (
          <button
            key={size}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSizeClick(size, inStock);
            }}
            disabled={!inStock}
            className={[
              'px-2.5 py-1 text-xs font-mono rounded border transition-all',
              inStock
                ? 'border-white/20 text-white/80 hover:border-green-500 hover:bg-green-500/10 hover:text-green-400'
                : 'border-white/5 text-white/20 line-through cursor-not-allowed',
            ].join(' ')}
            title={inStock ? `${size} — select to view product` : `${size} — out of stock`}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}
