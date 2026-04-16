'use client';

import { useState } from 'react';

interface Variant {
  size: string | null;
  color: string | null;
  inStock: boolean;
  stock: number;
}

interface SizeSelectorProps {
  variants: Variant[];
  productTitle: string;
}

export default function SizeSelector({ variants, productTitle }: SizeSelectorProps) {
  const [selected, setSelected] = useState<string | null>(null);

  // Only show sizes (dedupe by size name)
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

  return (
    <div className="mt-3">
      <p className="text-xs font-mono text-white/50 uppercase tracking-wider mb-2">Size</p>
      <div className="flex flex-wrap gap-1.5">
        {sizes.map(([size, { inStock }]) => (
          <button
            key={size}
            onClick={() => inStock && setSelected(selected === size ? null : size)}
            disabled={!inStock}
            className={[
              'px-2.5 py-1 text-xs font-mono rounded border transition-all',
              inStock
                ? selected === size
                  ? 'border-green-500 bg-green-500/20 text-green-400'
                  : 'border-white/20 text-white/70 hover:border-white/40'
                : 'border-white/5 text-white/20 line-through cursor-not-allowed',
            ].join(' ')}
            title={inStock ? `${size} — in stock` : `${size} — out of stock`}
          >
            {size}
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-green-400/80 font-mono mt-1.5">
          {selected} selected
        </p>
      )}
    </div>
  );
}
