'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectEmbed, useActiveAccount, useDisconnect, useActiveWallet } from 'thirdweb/react';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { OnboardStepsBuyer } from '../../OnboardStepsBuyer';
import { readOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';
import { isTestEmail, syntheticTestWallet } from '@/lib/app/test-mode';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// Funding wallet only. This is where the owner holds the USDC their Buying Agent
// spends; it is NOT the agent's identity wallet (that is platform-derived
// server-side). Users without a wallet get one via email/Google; users who
// already have one can connect it.
const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('walletConnect'),
];

export default function BuyerWallet() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [err,   setErr]   = useState('');

  const account      = useActiveAccount();
  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();

  const testMode = isTestEmail(email);
  const address  = testMode ? syntheticTestWallet(email) : (account?.address ?? '');

  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || s.role !== 'buyer' || !('handle' in s) || !s.handle) {
      router.replace('/onboard?role=buyer');
      return;
    }
    setEmail(s.email);
  }, [router]);

  // Persist the funding wallet as soon as it resolves. The agent identity wallet
  // is platform-derived server-side, never set here.
  useEffect(() => {
    if (address) writeOnboardState({ role: 'buyer', walletAddress: address });
  }, [address]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!ADDR_RE.test(address)) {
      setErr(testMode
        ? 'Test wallet failed to derive. Please reload.'
        : 'Sign in with email or Google, or connect a wallet, to provision your agent.');
      return;
    }
    writeOnboardState({ role: 'buyer', walletAddress: address });
    router.push('/onboard/buyer/done');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardStepsBuyer current={3} />
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Step 3 of 4</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Your funding wallet.
        </h1>
        <p className="text-ink-2 mb-10 max-w-lg">
          This is where you hold the USDC your Buying Agent spends. Your agent&rsquo;s on-chain
          identity is created and operated for you by VIA, you don&rsquo;t manage it. No wallet yet?
          Sign in with email or Google and we provision a non-custodial one for you.
        </p>

        <form onSubmit={onSubmit} className="space-y-8 max-w-xl">
          {testMode ? (
            <div className="p-4 border border-[color:var(--warning)] bg-[color:var(--warning)]/10">
              <div className="text-xs font-mono tracking-widest text-[color:var(--warning)] uppercase mb-2">Test mode</div>
              <div className="font-mono text-sm break-all text-ink mb-2">{address}</div>
              <p className="text-xs text-ink-2">
                Your email alias contains +test or +e2e, so we are skipping the thirdweb sign-in and
                using a deterministic stub wallet for this onboarding run. No OTP, no real on-chain
                identity. Reuse the same alias to land on the same stub wallet again.
              </p>
            </div>
          ) : account?.address ? (
            <div className="p-4 border border-ink bg-background">
              <div className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-2">Provisioned</div>
              <div className="font-mono text-sm break-all text-ink mb-3">{account.address}</div>
              <button
                type="button"
                onClick={() => { if (activeWallet) disconnect(activeWallet); }}
                className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink"
              >
                Use a different account
              </button>
            </div>
          ) : (
            <div className="border border-line-strong p-4">
              <ConnectEmbed client={thirdwebClient} wallets={wallets} showAllWallets={false} showThirdwebBranding={false} />
            </div>
          )}

          {err && <p className="text-sm text-[color:var(--danger)]">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/buyer/handle')}
              className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors"
            >
              <span aria-hidden>←</span> Back
            </button>
            <button type="submit" className="btn">
              Continue <span className="arrow" aria-hidden>→</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
