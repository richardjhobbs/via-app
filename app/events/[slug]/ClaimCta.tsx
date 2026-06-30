'use client';

import { useRouter } from 'next/navigation';
import { clearOnboardState, writeOnboardState } from '@/lib/app/onboarding-state';

/**
 * Routes the visitor into the Buying Agent onboarding wizard carrying the event
 * context. After the agent is created, the onboarding "done" step claims this
 * pass and binds it to the new buyer account (app/api/events/[slug]/claim).
 */
export function ClaimCta({ slug, tier, label, disabled }: { slug: string; tier: string; label: string; disabled?: boolean }) {
  const router = useRouter();

  function go() {
    clearOnboardState();
    writeOnboardState({ role: 'buyer', eventClaim: { slug, tier } });
    router.push('/onboard/account?role=buyer');
  }

  if (disabled) {
    return <span className="btn ghost pointer-events-none opacity-50">Sold out</span>;
  }
  return (
    <button onClick={go} className="btn">
      {label} <span className="arrow" aria-hidden>→</span>
    </button>
  );
}
