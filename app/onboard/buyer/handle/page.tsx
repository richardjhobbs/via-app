'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardStepsBuyer } from '../../OnboardStepsBuyer';
import { readOnboardState, writeOnboardState, slugifyName } from '@/lib/app/onboarding-state';

export default function BuyerHandle() {
  const router = useRouter();
  const [handle,      setHandle]      = useState('');
  const [displayName, setDisplayName] = useState('');
  const [touched,     setTouched]     = useState(false);
  const [err,         setErr]         = useState('');

  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || s.role !== 'buyer') { router.replace('/onboard?role=buyer'); return; }
    if (s.handle)      { setHandle(s.handle); setTouched(true); }
    if (s.displayName)   setDisplayName(s.displayName);
  }, [router]);

  useEffect(() => {
    if (!touched) setHandle(slugifyName(displayName));
  }, [displayName, touched]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!displayName.trim()) { setErr('Display name is required.'); return; }
    if (!handle)             { setErr('Handle must contain at least one alphanumeric character.'); return; }
    writeOnboardState({
      role:        'buyer',
      handle,
      displayName: displayName.trim(),
    });
    router.push('/onboard/buyer/wallet');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardStepsBuyer current={2} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 2 of 4</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          Your handle.
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          Your Buying Agent is reachable to seller agents at a personal MCP URL keyed off your
          handle. Pick something short and memorable.
        </p>

        <form onSubmit={onSubmit} className="space-y-5 max-w-xl">
          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">Display name</span>
            <input
              type="text" required value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 transition-colors rounded-md"
              placeholder="How you want your agent introduced (e.g. Richard H)"
            />
          </label>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">Handle</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500 font-mono">app.getvia.xyz/buyers/</span>
              <input
                type="text" required value={handle}
                onChange={(e) => { setHandle(slugifyName(e.target.value)); setTouched(true); }}
                className="flex-1 bg-white border border-neutral-300 px-4 py-3 text-base font-mono outline-none focus:border-neutral-900 transition-colors rounded-md"
              />
            </div>
            <span className="text-xs text-neutral-500 mt-2 block">
              Lowercase letters, numbers, hyphens. Auto-derived from your display name.
            </span>
          </label>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/account?role=buyer')}
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
