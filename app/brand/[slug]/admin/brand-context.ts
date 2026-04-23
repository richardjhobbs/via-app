'use client';

import { createContext, useContext } from 'react';

export interface BrandContext {
  brandId: string;
  brandName: string;
  brandSlug: string;
  userEmail: string;
}

export const BrandCtx = createContext<BrandContext | null>(null);
export const useBrandContext = () => useContext(BrandCtx);
