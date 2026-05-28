import type { ReactNode } from 'react';

/**
 * Passthrough layout. Every page under /seller/[slug]/admin/ provides its
 * own chrome and runs its own auth check via getSellerUser() / owner_user_id
 * match. The previous RRG-fork layout did a client-side /api/seller/auth/check
 * fetch that depended on app_seller_members (which doesn't exist in via-app's
 * schema) and redirected to /brand/login (which doesn't exist either).
 */
export default function SellerAdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
