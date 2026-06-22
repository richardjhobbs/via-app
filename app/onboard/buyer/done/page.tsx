'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { OnboardStepsBuyer } from '../../OnboardStepsBuyer';
import { readOnboardState, clearOnboardState, type BuyerOnboardState } from '@/lib/app/onboarding-state';

export default function BuyerDone() {
  const router = useRouter();
  const [state, setState] = useState<BuyerOnboardState | null>(null);
  const [err,   setErr]   = useState('');
  // When the email already has a VIA account, we route the owner to sign-in /
  // reset rather than dead-ending on the error string.
  const [existing, setExisting] = useState<{ email: string; ownsBuyer: boolean } | null>(null);
  // Register must fire exactly once. The effect can re-run (React Strict Mode
  // double-invoke in dev, or a router identity change) and the buyer/register
  // endpoint is not idempotent, so guard with a ref rather than the cancelled
  // flag (which only blocks state writes, not the duplicate POST).
  const submittedRef = useRef(false);

  useEffect(() => {
    const s = readOnboardState();
    if (!s || s.role !== 'buyer' || !s.email || !s.handle || !s.walletAddress) {
      router.replace('/onboard?role=buyer');
      return;
    }
    setState(s);
  }, [router]);

  useEffect(() => {
    if (!state) return;
    if (submittedRef.current) return;
    submittedRef.current = true;
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
          }),
        });
        if (cancelled) return;
        const data = await res.json();
        if (!res.ok) {
          if (data.existing_account) {
            setExisting({ email: data.email ?? state.email, ownsBuyer: Boolean(data.owns_buyer) });
          }
          setErr(data.error || 'Could not create your Buying Agent.');
          return;
        }
        clearOnboardState();
        // New agents land on their training surface, not the dashboard. This
        // matches the copy on this screen ("routing you to its training
        // surface") and means the first thing an owner does is brief their
        // agent, rather than staring at an empty dashboard.
        router.replace(`/buyer/${encodeURIComponent(data.buyer.handle)}/admin/buying-agent`);
      } catch (ex) {
        if (!cancelled) setErr(ex instanceof Error ? ex.message : 'network error, please retry');
      }
    })();
    return () => { cancelled = true; };
  }, [state, router]);

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardStepsBuyer current={4} />
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Step 4 of 4</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          {existing ? 'You already have a VIA account.' : err ? 'Something stopped us.' : 'Provisioning your Buying Agent…'}
        </h1>
        {existing ? (
          <div className="space-y-5 max-w-md">
            <p className="text-ink-2 text-sm">{err}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/buyer/login" className="btn">Sign in</Link>
              <Link
                href={`/buyer/login?forgot=true&email=${encodeURIComponent(existing.email)}`}
                className="btn ghost"
              >
                Reset password
              </Link>
            </div>
            <p className="text-xs text-ink-3">
              {existing.ownsBuyer
                ? 'This email already runs a Buying Agent, sign in to use it.'
                : 'Once you are signed in, your Buying Agent will be added to this account.'}
            </p>
          </div>
        ) : err ? (
          <p className="text-[color:var(--danger)] text-sm">{err}</p>
        ) : (
          <p className="text-ink-2">Creating your account, registering your agent on ERC-8004, and routing you to its training surface.</p>
        )}
      </div>
    </section>
  );
}
