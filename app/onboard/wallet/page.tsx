'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectEmbed, useActiveAccount, useDisconnect, useActiveWallet } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { OnboardSteps } from '../OnboardSteps';
import { readOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';
import { isTestEmail, syntheticTestWallet } from '@/lib/app/test-mode';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// Same in-app wallet config the rest of the app uses (lib/agent/types.ts
// pattern, also see components/agent/StepRegistration.tsx). Restricting to
// email + google keeps the agent-wallet onboarding short.
const wallets = [inAppWallet({ auth: { options: ['google', 'email'] } })];

export default function OnboardWallet() {
  const router = useRouter();

  // ── Payout wallet (pasted EOA, the seller's existing wallet) ──────
  const [email,   setEmail]   = useState('');
  const [payout,  setPayout]  = useState('');
  const [err,     setErr]     = useState('');

  // ── Agent wallet (provisioned via thirdweb inAppWallet, OR a
  //    deterministic stub when the user signed up with a +test/+e2e
  //    email alias) ───────────────────────────────────────────────
  const account      = useActiveAccount();
  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();

  const testMode         = isTestEmail(email);
  const testAgentAddress = testMode ? syntheticTestWallet(email) : '';
  const agentAddress     = testMode ? testAgentAddress : (account?.address ?? '');

  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || !('sellerName' in s) || !s.sellerName) {
      router.replace('/onboard?role=seller');
      return;
    }
    setEmail(s.email);
    if (s.walletAddress) setPayout(s.walletAddress);
    // Real agent address comes from the active thirdweb account; test-mode
    // agent address is derived from the email. Neither is restored from
    // localStorage directly.
  }, [router]);

  // Persist the agent wallet to localStorage whenever the connected
  // account changes so the next step has it without a server round-trip.
  useEffect(() => {
    if (agentAddress) writeOnboardState({ role: 'seller', agentWalletAddress: agentAddress });
  }, [agentAddress]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!ADDR_RE.test(payout.trim())) {
      setErr('Payout wallet must be a valid Base address (0x… 42 chars).');
      return;
    }
    if (!ADDR_RE.test(agentAddress)) {
      setErr(testMode
        ? 'Test wallet failed to derive — please reload.'
        : 'Sign in with email or Google to provision your Sales Agent’s wallet before continuing.');
      return;
    }
    if (payout.trim().toLowerCase() === agentAddress.toLowerCase()) {
      setErr('Payout wallet and agent wallet must be different. The agent wallet is created for you below, paste your own existing wallet for payouts above.');
      return;
    }
    writeOnboardState({
      role: 'seller',
      walletAddress:      payout.trim(),
      agentWalletAddress: agentAddress,
    });
    router.push('/onboard/catalog');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={3} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 3 of 5</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Wallets
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          You have two separate wallets. Your <strong>payout one</strong> receives the 97.5% USDC
          share of every sale. Your <strong>Sales Agent&apos;s wallet</strong> is what the agent
          uses to sign actions on-chain (negotiations and reputation events) and is what gets
          registered as its identity, it strengthens your agent&apos;s reputation.
        </p>

        <form onSubmit={onSubmit} className="space-y-10 max-w-xl">
          {/* Section A: payout wallet */}
          <div>
            <h2 className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-3 flex items-center gap-3">
              <span className="text-neutral-400">A</span>
              <span>Your payout wallet</span>
            </h2>
            <p className="text-sm text-neutral-600 mb-4">
              Paste an EVM wallet address you already control (MetaMask, Rabby, Coinbase Wallet, a
              Safe).
              {' '}
              <span className="block mt-2">
                If you don&apos;t already have one there are guidelines{' '}
                <a href="/faq/wallet" target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-900">here</a>
                {' '}with reasons and a simple walkthrough to create one.
              </span>
              <span className="block mt-2">97.5% of each sale lands here. Platform retains 2.5%.</span>
            </p>
            <input
              type="text"
              required
              spellCheck={false}
              autoComplete="off"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0x… (42 chars)"
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base font-mono outline-none focus:border-neutral-900 transition-colors rounded-md"
            />
          </div>

          {/* Section B: agent wallet (thirdweb in-app) */}
          <div>
            <h2 className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-3 flex items-center gap-3">
              <span className="text-neutral-400">B</span>
              <span>Your Sales Agent’s wallet</span>
            </h2>
            <p className="text-sm text-neutral-600 mb-4">
              Created for you. Sign in with email or Google and we provide a non-custodial wallet
              owned by your authorised identity. That wallet is part of your agent.
            </p>

            {testMode ? (
              <div className="p-4 border border-amber-700 bg-amber-50 rounded-md">
                <div className="text-xs font-mono tracking-widest text-amber-800 uppercase mb-2">Test mode</div>
                <div className="font-mono text-sm break-all text-neutral-900 mb-2">{testAgentAddress}</div>
                <p className="text-xs text-neutral-700">
                  Your email alias contains +test or +e2e, so we are skipping the thirdweb
                  sign-in and using a deterministic stub wallet for this onboarding run. No
                  OTP, no real on-chain identity. Reuse the same alias to land on the same
                  stub wallet again.
                </p>
              </div>
            ) : account?.address ? (
              <div className="p-4 border border-neutral-900 bg-neutral-50 rounded-md">
                <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-2">Provisioned</div>
                <div className="font-mono text-sm break-all text-neutral-900 mb-3">{account.address}</div>
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
                <ConnectEmbed
                  client={thirdwebClient}
                  wallets={wallets}
                  showAllWallets={false}
                  showThirdwebBranding={false}
                />
              </div>
            )}
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/business')}
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
