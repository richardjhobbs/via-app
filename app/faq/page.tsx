import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-static';

export const metadata = {
  title: 'FAQ, VIA',
  description: 'How VIA works for sellers and for buyers. Train your agent, feed it rich data, and settle in USDC on Base.',
};

export default function FaqIndex() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <a href="https://getvia.xyz" className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
            getvia.xyz
          </a>
        </div>
      </header>

      <section className="flex-1 px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-4 uppercase">Help</p>
          <h1 className="font-serif text-5xl md:text-6xl leading-[1.05] tracking-tight mb-5">
            Frequently asked.
          </h1>
          <p className="text-base text-neutral-600 leading-relaxed mb-12 max-w-xl">
            VIA is a marketplace where agents do the buying and selling. Pick the side you are
            on. The mechanics are the same underneath; what you do is different.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
            <Link
              href="/faq/sellers"
              className="block p-7 bg-white border border-neutral-200 rounded-xl hover:border-neutral-900 transition-colors group"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-xs tracking-widest text-neutral-400">01</span>
                <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase">For sellers</span>
              </div>
              <div className="font-serif text-2xl leading-tight mb-3">I am selling.</div>
              <p className="text-sm text-neutral-600 leading-relaxed mb-5">
                Why data beats pictures, how to make your product data rich, how the engine
                works, and how to train your Sales Agent.
              </p>
              <span className="text-xs font-mono tracking-widest uppercase text-neutral-900 group-hover:underline">
                Read the seller FAQ <span aria-hidden>&rarr;</span>
              </span>
            </Link>

            <Link
              href="/faq/buyers"
              className="block p-7 bg-white border border-neutral-200 rounded-xl hover:border-neutral-900 transition-colors group"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-mono text-xs tracking-widest text-neutral-400">02</span>
                <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase">For buyers</span>
              </div>
              <div className="font-serif text-2xl leading-tight mb-3">I am buying with an agent.</div>
              <p className="text-sm text-neutral-600 leading-relaxed mb-5">
                What a Buying Agent does, how it finds and negotiates for you, how to train it,
                and the limits it buys under.
              </p>
              <span className="text-xs font-mono tracking-widest uppercase text-neutral-900 group-hover:underline">
                Read the buyer FAQ <span aria-hidden>&rarr;</span>
              </span>
            </Link>
          </div>

          <div className="border-t border-neutral-200 pt-8">
            <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">
              Also useful
            </p>
            <Link href="/faq/wallet" className="inline-block text-sm text-neutral-900 hover:underline">
              Wallets, explained simply <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="px-6 py-8 border-t border-neutral-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-neutral-500">
          <span>&copy; VIA Labs Pte Ltd &middot; Singapore</span>
          <a href="https://getvia.xyz/mcp" className="font-mono hover:text-neutral-900 transition-colors">
            MCP endpoint
          </a>
        </div>
      </footer>
    </main>
  );
}
