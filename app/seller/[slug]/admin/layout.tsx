import type { ReactNode } from 'react';

/**
 * Passthrough layout. Every page under /seller/[slug]/admin/ provides its
 * own chrome and runs its own auth check via getSellerUser() + an
 * app_seller_members membership lookup (isSellerMember / getSellerRole).
 * The previous RRG-fork layout did a client-side /api/seller/auth/check
 * fetch and redirected to /brand/login (which doesn't exist here).
 */
export default function SellerAdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
