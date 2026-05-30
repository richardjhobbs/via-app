'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';
import { OnboardStepsBuyer } from '../OnboardStepsBuyer';
import { readOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';

function AccountInner() {
  const router = useRouter();
  const params = useSearchParams();
  const role = (params.get('role') === 'buyer' ? 'buyer' : 'seller') as 'seller' | 'buyer';

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr]           = useState('');

  // Restore prior input if user refreshes / back-buttons.
  useEffect(() => {
    const s = readOnboardState();
    if (s?.email) setEmail(s.email);
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setErr('Enter a valid email.'); return; }
    if (password.length < 8)                          { setErr('Password must be 8+ characters.'); return; }

    writeOnboardState({ role, email: trimmed, password });
    if (role === 'buyer') router.push('/onboard/buyer/handle');
    else                  router.push('/onboard/business');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        {role === 'buyer' ? <OnboardStepsBuyer current={1} /> : <OnboardSteps current={1} />}
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">
          Step 1 of {role === 'buyer' ? '4' : '5'} · {role === 'buyer' ? 'Buying Agent' : 'Sales Agent'}
        </p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Create your account.
        </h1>
        <p className="text-ink-2 mb-10 max-w-lg">
          {role === 'buyer'
            ? 'We use this to sign you in so you can train your agent, set your preferences and caps, and review what it buys for you.'
            : 'We use this to sign you in so you can update your store, see payouts, converse with your agent, and check receipts.'}
        </p>

        <form onSubmit={onSubmit} className="space-y-5 max-w-md">
          <label className="block">
            <span className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 text-base outline-none focus:border-ink transition-colors"
            />
          </label>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">Password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 text-base outline-none focus:border-ink transition-colors"
            />
            <span className="text-xs text-ink-3 mt-2 block">Minimum 8 characters.</span>
          </label>

          {err && <p className="text-sm text-[color:var(--danger)]">{err}</p>}

          <button type="submit" className="btn">
            Continue <span className="arrow" aria-hidden>→</span>
          </button>
        </form>

        <p className="text-sm text-ink-2 mt-6">
          Already have an account?{' '}
          <Link
            href={role === 'buyer' ? '/buyer/login' : '/seller/login'}
            className="underline underline-offset-4 hover:text-ink"
          >
            Log in
          </Link>
        </p>
      </div>
    </section>
  );
}

// useSearchParams forces dynamic; wrap in Suspense so the page can be
// prerendered without bailing out the whole build.
export default function OnboardAccount() {
  return (
    <Suspense fallback={null}>
      <AccountInner />
    </Suspense>
  );
}
