import type { ReactNode } from 'react';
import { BackRoomBanner } from '@/components/app/BackRoomBanner';

/**
 * Layout for /seller/[slug]/admin/. Each page runs its own auth check; the
 * layout adds the Back Room entry across every seller admin surface so a
 * signed-in seller can reach and form rooms from anywhere in their dashboard.
 */
export default function SellerAdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <BackRoomBanner href="/backroom" />
      {children}
    </>
  );
}
