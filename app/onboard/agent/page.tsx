'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';

export default function OnboardAgent() {
  const router = useRouter();
  const params = useSearchParams();
  const slug = params.get('slug');

  useEffect(() => {
    if (!slug) { router.replace('/'); return; }
    // Small delay so the user sees the success state before the redirect.
    const t = setTimeout(() => {
      router.replace(`/seller/${encodeURIComponent(slug)}/admin/sales-agent`);
    }, 1500);
    return () => clearTimeout(t);
  }, [router, slug]);

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={5} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 5 of 5 · Done</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          You&apos;re live.
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          Routing you to your Sales Agent now. Brief it on what you offer, what makes you
          different, and what terms buyers should expect. Everything you say is what it
          will surface to buying agents.
        </p>

        <p className="text-xs font-mono tracking-widest text-neutral-500 uppercase">Loading <span className="animate-pulse">…</span></p>
      </div>
    </section>
  );
}
