'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';
import { readOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export default function OnboardWallet() {
  const router = useRouter();

  // The seller provides ONE wallet: their payout EOA (receives the 97.5% share).
  // The Sales Agent's on-chain identity wallet is created and operated by the
  // platform (derived from a server seed); the seller never holds or manages it.
  const [payout, setPayout] = useState('');
  const [err,    setErr]    = useState('');

  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || !('sellerName' in s) || !s.sellerName) {
      router.replace('/onboard?role=seller');
      return;
    }
    if (s.walletAddress) setPayout(s.walletAddress);
  }, [router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!ADDR_RE.test(payout.trim())) {
      setErr('Payout wallet must be a valid 0x… address (42 chars).');
      return;
    }
    writeOnboardState({ role: 'seller', walletAddress: payout.trim() });
    router.push('/onboard/catalog');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={3} />
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Step 3 of 5</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Your payout wallet
        </h1>
        <p className="text-ink-2 mb-10 max-w-lg">
          Paste an EVM wallet you already control. 97.5% of every sale lands here; the platform
          retains 2.5%. Your Sales Agent&apos;s on-chain identity wallet is created and operated for
          you by VIA, you don&apos;t manage it.
        </p>

        <form onSubmit={onSubmit} className="space-y-10 max-w-xl">
          <div>
            <p className="text-sm text-ink-2 mb-4">
              MetaMask, Rabby, Coinbase Wallet, a Safe, anything you control.
              {' '}
              <span className="block mt-2">
                If you don&apos;t already have one there are guidelines{' '}
                <a href="/faq/wallet" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">here</a>
                {' '}with reasons and a simple walkthrough to create one.
              </span>
            </p>
            <input
              type="text"
              required
              spellCheck={false}
              autoComplete="off"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0x… (42 chars)"
              className="w-full bg-paper border border-line-strong px-4 py-3 text-base font-mono outline-none focus:border-ink transition-colors"
            />
          </div>

          {err && <p className="text-sm text-[color:var(--danger)]">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/business')}
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
