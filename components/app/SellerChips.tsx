'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface Brand {
  slug: string;
  name: string;
}

export default function SellerChips({
  brands,
  selected,
}: {
  brands: Brand[];
  selected: string; // 'all' or brand slug
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleClick = (slug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (slug === 'all') {
      params.delete('brand');
    } else {
      params.set('brand', slug);
    }
    // Reset page and brief when switching brands (briefs are brand-scoped)
    params.delete('page');
    params.delete('brief');
    const qs = params.toString();
    router.push(qs ? `/rrg?${qs}` : '/rrg');
  };

  const chipClass = (slug: string) => {
    const active = slug === selected;
    return `px-3 py-1 text-[11px] font-mono uppercase tracking-wider border transition-all cursor-pointer ${
      active
        ? 'border-white text-white'
        : 'border-white/15 text-white/35 hover:border-white/40 hover:text-white/60'
    }`;
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => handleClick('all')} className={chipClass('all')}>
        All
      </button>
      {brands.map((b) => (
        <button key={b.slug} onClick={() => handleClick(b.slug)} className={chipClass(b.slug)}>
          {b.name}
        </button>
      ))}
    </div>
  );
}
