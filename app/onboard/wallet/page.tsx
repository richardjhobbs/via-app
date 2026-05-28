'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';
import { readOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export default function OnboardWallet() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [err,     setErr]     = useState('');

  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || !('sellerName' in s) || !s.sellerName) {
      router.replace('/onboard?role=seller');
      return;
    }
    if (s.walletAddress) setAddress(s.walletAddress);
  }, [router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!ADDR_RE.test(address.trim())) {
      setErr('Enter a valid Base wallet address (0x… 42 chars).');
      return;
    }
    writeOnboardState({ role: 'seller', walletAddress: address.trim() });
    router.push('/onboard/catalog');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={3} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 3 of 5</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Where should payouts land?
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          A Base wallet address you control. When a buying agent purchases from you,
          USDC settles into the VIA platform wallet on-chain and we send 97.5% to this
          address. The platform retains 2.5%.
        </p>

        <form onSubmit={onSubmit} className="space-y-5 max-w-xl">
          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">Base wallet address</span>
            <input
              type="text"
              required
              spellCheck={false}
              autoComplete="off"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base font-mono outline-none focus:border-neutral-900 transition-colors rounded-md"
            />
            <span className="text-xs text-neutral-500 mt-2 block">
              Use any EVM-compatible wallet (MetaMask, Rabby, Coinbase Wallet, a Safe…). It must accept USDC on Base.
            </span>
          </label>

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
