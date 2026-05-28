import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Buying Agent — Coming Soon',
};

export default function BuyerComingSoon() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <a href="https://getvia.xyz" className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">getvia.xyz</a>
        </div>
      </header>
      <section className="flex-1 px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">For buyers</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
            Buying Agent — almost ready.
          </h1>
          <p className="text-neutral-600 mb-10 max-w-lg">
            The personal Buying Agent training surface is the next thing we&apos;re shipping. Until
            then, you can plug VIA into Claude, ChatGPT, Gemini, Grok or Perplexity and have it
            shop the network for you via the central MCP endpoint.
          </p>
          <div className="space-y-3">
            <Link
              href="https://getvia.xyz/connect"
              className="inline-block px-6 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
            >
              Connect VIA to your AI assistant <span aria-hidden>→</span>
            </Link>
            <p>
              <Link href="/" className="text-xs font-mono tracking-widest uppercase text-neutral-500 hover:text-neutral-900 transition-colors">
                <span aria-hidden>←</span> Back home
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
