import Image from 'next/image';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata = {
  title: 'VIA — Sales & Buying Agents',
  description: 'Onboard your business as a VIA seller, or train a personal Buying Agent. Agentic commerce settled in USDC on Base.',
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      {/* Dark header band — VIA logo (white PNG) sits on neutral-900 like getvia.xyz. */}
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image
              src="/vialogowhite.png"
              alt="VIA"
              width={72}
              height={28}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <a
            href="https://getvia.xyz"
            className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors"
          >
            getvia.xyz
          </a>
        </div>
      </header>

      <section className="flex-1 px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-4 uppercase">
            Pick a path
          </p>
          <h1 className="font-serif text-5xl md:text-6xl leading-[1.05] tracking-tight mb-5">
            Sales Agent or<br />Buying Agent.
          </h1>
          <p className="text-base text-neutral-600 leading-relaxed mb-12 max-w-xl">
            Onboard your store, your service, or your single product and get a Sales Agent that
            pitches to buying agents on your behalf. Or train a personal Buying Agent that finds,
            negotiates, and books for you.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-12">
            <Link
              href="/onboard?role=seller"
              className="block p-7 bg-white border border-neutral-200 rounded-xl hover:border-neutral-900 transition-colors group"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-xs tracking-widest text-neutral-400">01</span>
                <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase">For sellers</span>
              </div>
              <div className="font-serif text-2xl leading-tight mb-3">I want to sell.</div>
              <p className="text-sm text-neutral-600 leading-relaxed mb-5">
                Register your business, sync or list your offer, and meet your Sales Agent.
                Settles in USDC on Base.
              </p>
              <span className="text-xs font-mono tracking-widest uppercase text-neutral-900 group-hover:underline">
                Onboard <span aria-hidden>→</span>
              </span>
            </Link>

            <Link
              href="/onboard?role=buyer"
              className="block p-7 bg-white border border-neutral-200 rounded-xl hover:border-neutral-900 transition-colors group"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-xs tracking-widest text-neutral-400">02</span>
                <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase">For buyers</span>
              </div>
              <div className="font-serif text-2xl leading-tight mb-3">I want to buy with an agent.</div>
              <p className="text-sm text-neutral-600 leading-relaxed mb-5">
                Train a personal Buying Agent that knows your preferences, budget, and limits.
                It negotiates with seller agents on your behalf.
              </p>
              <span className="text-xs font-mono tracking-widest uppercase text-neutral-900 group-hover:underline">
                Train your agent <span aria-hidden>→</span>
              </span>
            </Link>
          </div>

          <div className="border-t border-neutral-200 pt-8">
            <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">
              Already onboarded
            </p>
            <Link
              href="/seller/login"
              className="inline-block text-sm text-neutral-900 hover:underline"
            >
              Seller sign in <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="px-6 py-8 border-t border-neutral-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-neutral-500">
          <span>© VIA Labs Pte Ltd · Singapore</span>
          <a href="https://getvia.xyz/mcp" className="font-mono hover:text-neutral-900 transition-colors">
            MCP endpoint
          </a>
        </div>
      </footer>
    </main>
  );
}
