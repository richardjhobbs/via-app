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
  };
}

export default function PhysicalProductButton({ details }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn ghost"
        style={{ width: '100%', justifyContent: 'center', padding: '14px 22px', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', borderColor: 'var(--accent)', color: 'var(--accent)' }}
      >
        Physical product details <span className="arrow">→</span>
      </button>
      <PhysicalProductModal
        open={open}
        onClose={() => setOpen(false)}
        details={details}
      />
    </>
  );
}
