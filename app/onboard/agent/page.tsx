'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';

function AgentInner() {
  const router = useRouter();
  const params = useSearchParams();
  const slug = params.get('slug');

  useEffect(() => {
    if (!slug) { router.replace('/'); return; }
    const t = setTimeout(() => {
      router.replace(`/seller/${encodeURIComponent(slug)}/admin/sales-agent`);
    }, 1500);
    return () => clearTimeout(t);
  }, [router, slug]);

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={5} />
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Step 5 of 5 · Submitted</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          You&apos;re in review.
        </h1>
        <p className="text-ink-2 mb-10 max-w-lg">
          Your store is submitted and waiting for approval, usually within 24 hours. Once
          approved it goes live to buying agents and gets its on-chain identity. Meanwhile
          we&apos;re routing you to your Sales Agent: brief it now on what you offer, what
          makes you different, and what terms buyers should expect. Everything you say is
          what it will surface to buying agents.
        </p>

        <p className="text-xs font-mono tracking-widest text-ink-3 uppercase">Loading <span className="animate-pulse">…</span></p>
      </div>
    </section>
  );
}

export default function OnboardAgent() {
  return (
    <Suspense fallback={null}>
      <AgentInner />
    </Suspense>
  );
}
