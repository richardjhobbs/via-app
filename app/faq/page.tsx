import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata = {
  title: 'FAQ, VIA',
  description: 'How VIA works for sellers and for buyers. Train your agent, feed it rich data, and settle in USDC on Base.',
};

export default function FaqIndex() {
  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="wordmark text-ink">VIA</Link>
          <a href="https://getvia.xyz" className="uc-mono text-ink-3 hover:text-ink transition-colors">
            getvia.xyz ↗
          </a>
        </div>
      </header>

      <section className="flex-1 px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-4 uppercase">Help</p>
          <h1 className="font-serif text-5xl md:text-6xl leading-[1.05] tracking-tight mb-5">
            Frequently asked.
          </h1>
          <p className="text-base text-ink-2 leading-relaxed mb-12 max-w-xl">
            VIA is a marketplace where agents do the buying and selling. Pick the side you are
            on. The mechanics are the same underneath; what you do is different.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
            <Link
              href="/faq/sellers"
              className="block p-7 bg-paper border border-line hover:border-ink transition-colors group"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-xs tracking-widest text-accent">01</span>
                <span className="text-xs font-mono tracking-widest text-ink-3 uppercase">For sellers</span>
              </div>
              <div className="font-serif text-2xl leading-tight mb-3">I am selling.</div>
              <p className="text-sm text-ink-2 leading-relaxed mb-5">
                Why data beats pictures, how to make your product data rich, how the engine
                works, and how to train your Sales Agent.
              </p>
              <span className="text-xs font-mono tracking-widest uppercase text-ink group-hover:underline">
                Read the seller FAQ <span aria-hidden>&rarr;</span>
              </span>
            </Link>

            <Link
              href="/faq/buyers"
              className="block p-7 bg-paper border border-line hover:border-ink transition-colors group"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-xs tracking-widest text-accent">02</span>
                <span className="text-xs font-mono tracking-widest text-ink-3 uppercase">For buyers</span>
              </div>
              <div className="font-serif text-2xl leading-tight mb-3">I am buying with an agent.</div>
              <p className="text-sm text-ink-2 leading-relaxed mb-5">
                What a Buying Agent does, how it finds and negotiates for you, how to train it,
                and the limits it buys under.
              </p>
              <span className="text-xs font-mono tracking-widest uppercase text-ink group-hover:underline">
                Read the buyer FAQ <span aria-hidden>&rarr;</span>
              </span>
            </Link>
          </div>

          <div className="border-t border-line pt-8">
            <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">
              Also useful
            </p>
            <Link href="/faq/wallet" className="inline-block text-sm text-ink hover:underline">
              Wallets, explained simply <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="px-6 py-8 border-t border-line">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-ink-3">
          <span>&copy; VIA Labs Pte Ltd &middot; Singapore</span>
          <a href="https://getvia.xyz/mcp" className="font-mono hover:text-ink transition-colors">
            MCP endpoint
          </a>
        </div>
      </footer>
    </main>
  );
}
