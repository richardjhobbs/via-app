'use client';

import { useState } from 'react';
import PhysicalProductModal from '@/components/rrg/PhysicalProductModal';

interface SizeChartData {
  chart: Array<{ size: string; [key: string]: string | number | undefined }>;
  unit: string;
  fitNotes: string | null;
  brandName: string;
  category: string;
  availableSizes: string[];
}

interface Props {
  details: {
    physicalDescription: string | null;
    physicalImageUrls: string[];
    priceIncludesTax: boolean;
    priceIncludesPacking: boolean;
    ecommerceUrl: string | null;
    shippingType: string | null;
    shippingIncludedRegions: string[] | null;
    refundCommitment: boolean;
    collectionInPerson: string | null;
    sizeChart?: SizeChartData | null;
    enhancedDescription?: string | null;
  };
}

export default function PhysicalProductButton({ details }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mb-6 w-full py-3 border border-lime-400/40 text-lime-400 text-base font-mono
                   uppercase tracking-widest hover:bg-lime-400/10 transition-all"
      >
        Physical Product Details →
      </button>
      <PhysicalProductModal
        open={open}
        onClose={() => setOpen(false)}
        details={details}
      />
    </>
  );
}
