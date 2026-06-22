'use client';

import { useEffect, useRef } from 'react';
import { useActiveAccount, useActiveWallet } from 'thirdweb/react';

/**
 * Keeps a buyer's recorded spend/recognition wallet in step with the in-app
 * wallet they are actually signed in with. Mounted on every buyer-admin page
 * (via the admin layout). Fires once per connected address, and ONLY for the
 * in-app wallet , never an external wallet a buyer might connect to pay with.
 *
 * `currentWallet` is the address already on file; when it already matches the
 * connected wallet, nothing is sent.
 */
export function BuyerWalletSync({ buyerId, currentWallet }: { buyerId: string; currentWallet: string | null }) {
  const account = useActiveAccount();
  const wallet  = useActiveWallet();
  const done    = useRef<string | null>(null);

  useEffect(() => {
    const addr = account?.address?.toLowerCase();
    if (!addr || wallet?.id !== 'inApp') return;
    if (addr === (currentWallet ?? '').toLowerCase()) return; // already pinned
    if (done.current === addr) return;                         // posted this address already
    done.current = addr;
    void fetch('/api/buyer/reconcile-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId, wallet: addr }),
    }).catch(() => { /* best-effort: a missed sync retries next mount */ });
  }, [account?.address, wallet?.id, buyerId, currentWallet]);

  return null;
}
