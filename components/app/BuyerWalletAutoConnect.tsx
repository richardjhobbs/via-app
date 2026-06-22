'use client';

import { useEffect, useRef } from 'react';
import { useActiveAccount, useConnect, useDisconnect } from 'thirdweb/react';
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
  const { disconnect } = useDisconnect();
  const tried = useRef(false);

  useEffect(() => {
    if (!ENABLED || !active || account || tried.current) return;
    tried.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/buyer/wallet-token');
        if (!res.ok) return; // 401/404/503 -> fall back to manual connect
        const { jwt, expected_wallet } = (await res.json()) as { jwt?: string; expected_wallet?: string | null };
        if (!jwt) return;
        const wallet = await connect(async () => {
          const w = inAppWallet();
          await w.connect({ client: thirdwebClient, strategy: 'jwt', jwt });
          return w;
        });
        // Safety: the JWT must resolve to the buyer's FUNDED wallet. If thirdweb
        // returned a different address (the jwt `sub` did not unify with their
        // email-created wallet), disconnect rather than silently transacting from
        // a new empty wallet , the buyer then connects manually as before.
        const got = wallet?.getAccount()?.address?.toLowerCase();
        if (wallet && expected_wallet && got && got !== expected_wallet.toLowerCase()) {
          console.warn('[wallet-autoconnect] JWT wallet', got, '!= funded wallet', expected_wallet, '- disconnecting');
          disconnect(wallet);
        }
      } catch {
        /* silent: the manual connect UI remains available */
      }
    })();
  }, [active, account, connect, disconnect]);

  return null;
}
