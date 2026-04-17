// Block on the RRG landing page pointing brand owners at the onboarding
// flow at /brands. Lives between the brand directory and the CTA row.

import Link from 'next/link';

export default function BringYourStoreBlock() {
  return (
    <section className="mb-12">
      <div className="relative overflow-hidden rounded-lg border border-green-500/40 bg-green-500/[0.04] p-6 md:p-8 shadow-[0_0_30px_-12px_rgba(34,197,94,0.4)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span aria-hidden className="relative inline-flex h-2 w-2 rounded-full bg-green-500">
                <span className="absolute inset-0 animate-ping rounded-full bg-green-500/60" />
              </span>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-green-400">
                Founding Merchants
              </p>
            </div>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              Bring your store to Real Real Genuine.
            </h3>
            <p className="mt-2 text-sm text-white/80 md:text-base">
              Connect your shop in about fifteen minutes. Free for our first
              fifty founding merchants. Your own agent-ready endpoint and a
              concierge agent minted on Base once you're approved.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Link
              href="/brands"
              className="inline-flex items-center justify-center rounded-full bg-green-500 px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-green-400"
            >
              Start onboarding &rarr;
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
