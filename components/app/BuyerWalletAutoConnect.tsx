'use client';

import { useEffect, useRef } from 'react';
import { useActiveAccount, useConnect } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/app/thirdwebClient';

/**
 * Silently connects a logged-in buyer's OWN thirdweb in-app wallet at checkout,
 * using a VIA-minted JWT (custom OIDC strategy). No wallet chooser, no email OTP.
 *
 * Gated by NEXT_PUBLIC_VIA_WALLET_JWT_ENABLED so it stays off until the thirdweb
 * dashboard custom-auth + the signing key are in place AND address continuity has
 * been verified (the JWT must resolve to the buyer's funded wallet, not a new
 * empty one). While off, checkout falls back to the manual connect buttons.
 *
 * `active` should be true only when the page recognised a logged-in buyer.
 */
const ENABLED = process.env.NEXT_PUBLIC_VIA_WALLET_JWT_ENABLED === 'true';

export function BuyerWalletAutoConnect({ active }: { active: boolean }) {
  const account = useActiveAccount();
  const { connect } = useConnect();
  const tried = useRef(false);

  useEffect(() => {
    if (!ENABLED || !active || account || tried.current) return;
    tried.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/buyer/wallet-token');
        if (!res.ok) return; // 401/404/503 -> fall back to manual connect
        const { jwt } = (await res.json()) as { jwt?: string };
        if (!jwt) return;
        await connect(async () => {
          const wallet = inAppWallet();
          await wallet.connect({ client: thirdwebClient, strategy: 'jwt', jwt });
          return wallet;
        });
      } catch {
        /* silent: the manual connect UI remains available */
      }
    })();
  }, [active, account, connect]);

  return null;
}
