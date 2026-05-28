'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectEmbed, useActiveAccount, useDisconnect, useActiveWallet } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { OnboardStepsBuyer } from '../../OnboardStepsBuyer';
import { readOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const wallets = [inAppWallet({ auth: { options: ['google', 'email'] } })];

export default function BuyerWallet() {
  const router = useRouter();
  const [funding, setFunding] = useState('');
  const [err,     setErr]     = useState('');

  const account      = useActiveAccount();
  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();
  const agentAddress = account?.address ?? '';

  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || s.role !== 'buyer' || !('handle' in s) || !s.handle) {
      router.replace('/onboard?role=buyer');
      return;
    }
    if (s.walletAddress) setFunding(s.walletAddress);
  }, [router]);

  useEffect(() => {
    if (agentAddress) writeOnboardState({ role: 'buyer', agentWalletAddress: agentAddress });
  }, [agentAddress]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!ADDR_RE.test(funding.trim())) {
      setErr('Funding wallet must be a valid Base address (0x… 42 chars).');
      return;
    }
    if (!ADDR_RE.test(agentAddress)) {
      setErr('Sign in with email or Google to provision your Buying Agent’s wallet.');
      return;
    }
    if (funding.trim().toLowerCase() === agentAddress.toLowerCase()) {
      setErr('Funding wallet and agent wallet must be different EOAs.');
      return;
    }
    writeOnboardState({
      role:               'buyer',
      walletAddress:      funding.trim(),
      agentWalletAddress: agentAddress,
    });
    router.push('/onboard/buyer/done');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardStepsBuyer current={3} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 3 of 4</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Wallets.
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          Two wallets, two roles. Your <strong>funding wallet</strong> holds the USDC your agent
          spends. Your <strong>Buying Agent’s wallet</strong> is its on-chain identity, registered
          as ERC-8004 so seller agents know who they’re negotiating with.
        </p>

        <form onSubmit={onSubmit} className="space-y-10 max-w-xl">
          <div>
            <h2 className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-3 flex items-center gap-3">
              <span className="text-neutral-400">A</span><span>Your funding wallet</span>
            </h2>
            <p className="text-sm text-neutral-600 mb-4">
              Paste a Base wallet address you already control. Your agent never holds your funds — it
              requests x402 payment that comes from this wallet.
            </p>
            <input
              type="text" required spellCheck={false} autoComplete="off"
              value={funding} onChange={(e) => setFunding(e.target.value)}
              placeholder="0x… (42 chars)"
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base font-mono outline-none focus:border-neutral-900 transition-colors rounded-md"
            />
          </div>

          <div>
            <h2 className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-3 flex items-center gap-3">
              <span className="text-neutral-400">B</span><span>Your Buying Agent’s wallet</span>
            </h2>
            <p className="text-sm text-neutral-600 mb-4">
              Created for you. Sign in with email or Google — we provision a non-custodial EOA bound
              to your auth identity. That wallet IS your agent on-chain.
            </p>

            {agentAddress ? (
              <div className="p-4 border border-neutral-900 bg-neutral-50 rounded-md">
                <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-2">Provisioned</div>
                <div className="font-mono text-sm break-all text-neutral-900 mb-3">{agentAddress}</div>
                <button
                  type="button"
                  onClick={() => { if (activeWallet) disconnect(activeWallet); }}
                  className="text-xs font-mono tracking-widest uppercase text-neutral-500 hover:text-neutral-900"
                >
                  Use a different account
                </button>
              </div>
            ) : (
              <div className="border border-neutral-300 rounded-md p-4">
                <ConnectEmbed client={thirdwebClient} wallets={wallets} showAllWallets={false} showThirdwebBranding={false} />
              </div>
            )}
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/buyer/handle')}
              className="text-xs font-mono tracking-widest uppercase text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              <span aria-hidden>←</span> Back
            </button>
            <button
              type="submit"
              className="px-6 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
            >
              Continue <span aria-hidden>→</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
