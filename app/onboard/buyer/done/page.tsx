'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardStepsBuyer } from '../../OnboardStepsBuyer';
import { readOnboardState, clearOnboardState, type BuyerOnboardState } from '@/lib/app/onboarding-state';

export default function BuyerDone() {
  const router = useRouter();
  const [state, setState] = useState<BuyerOnboardState | null>(null);
  const [err,   setErr]   = useState('');

  useEffect(() => {
    const s = readOnboardState();
    if (!s || s.role !== 'buyer' || !s.email || !s.handle || !s.walletAddress || !s.agentWalletAddress) {
      router.replace('/onboard?role=buyer');
      return;
    }
    setState(s);
  }, [router]);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/buyer/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email:              state.email,
            password:           state.password,
            handle:             state.handle,
            displayName:        state.displayName,
            walletAddress:      state.walletAddress,
            agentWalletAddress: state.agentWalletAddress,
          }),
        });
        if (cancelled) return;
        const data = await res.json();
        if (!res.ok) { setErr(data.error || 'Could not create your Buying Agent.'); return; }
        clearOnboardState();
        router.replace(`/buyer/${encodeURIComponent(data.buyer.handle)}/admin`);
      } catch (ex) {
        if (!cancelled) setErr(ex instanceof Error ? ex.message : 'network error — please retry');
      }
    })();
    return () => { cancelled = true; };
  }, [state, router]);

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardStepsBuyer current={4} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 4 of 4</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          {err ? 'Something stopped us.' : 'Provisioning your Buying Agent…'}
        </h1>
        {err ? (
          <p className="text-red-600 text-sm">{err}</p>
        ) : (
          <p className="text-neutral-600">Creating your account, registering your agent on ERC-8004, and routing you to its training surface.</p>
        )}
      </div>
    </section>
  );
}
