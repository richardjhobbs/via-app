'use client';

import { createContext, useContext } from 'react';

export interface SellerContext {
  sellerId: string;
  sellerName: string;
  sellerSlug: string;
  userEmail: string;
}

export const BrandCtx = createContext<SellerContext | null>(null);
export const useSellerContext = () => useContext(BrandCtx);
