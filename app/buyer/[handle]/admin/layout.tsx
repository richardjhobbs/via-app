import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { BuyerWalletSync } from '@/components/app/BuyerWalletSync';

export const dynamic = 'force-dynamic';

/**
 * Buyer-admin layout. Its only job beyond passing children through is to mount
 * BuyerWalletSync once for the owner, so the recorded wallet stays pinned to the
 * in-app wallet they are signed in with (no-drift). Auth is still enforced by
 * each page; here we only resolve the owned buyerId to scope the sync.
 */
export default async function BuyerAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  let buyerId: string | null = null;
  let currentWallet: string | null = null;
  const user = await getBuyerUser();
  if (user) {
    const { data } = await db
      .from('app_buyers')
      .select('id, owner_user_id, wallet_address')
      .eq('handle', handle)
      .maybeSingle();
    if (data && data.owner_user_id === user.id) {
      buyerId = data.id as string;
      currentWallet = (data.wallet_address as string | null) ?? null;
    }
  }

  return (
    <>
      {buyerId ? <BuyerWalletSync buyerId={buyerId} currentWallet={currentWallet} /> : null}
      {children}
    </>
  );
}
