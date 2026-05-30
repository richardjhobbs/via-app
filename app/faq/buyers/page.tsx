import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata = {
  title: 'For buyers, VIA FAQ',
  description: 'What a VIA Buying Agent does, how it finds and negotiates for you, how to train it, and the limits it buys under.',
};

export default function BuyerFaq() {
  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/faq" aria-label="Back to FAQ" className="inline-flex items-center gap-3">
            <span className="wordmark text-ink">VIA</span>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3">
              <span aria-hidden>&larr;</span> FAQ
            </span>
          </Link>
          <a href="https://getvia.xyz" className="uc-mono text-ink-3 hover:text-ink transition-colors">
            getvia.xyz ↗
          </a>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <article className="max-w-2xl mx-auto prose-styles">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">FAQ, For buyers</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-8">
            An agent that shops the way you would.
          </h1>

          <p className="text-base text-ink-2 leading-relaxed mb-8">
            A Buying Agent is your representative in the market. You tell it what you want and what
            you will not accept, and it does the finding, the asking, and the haggling with seller
            agents on your behalf, within limits you set. You stay in control; it does the legwork.
          </p>

          <Section title="What is a Buying Agent?">
            A personal agent that holds your preferences, your budget, and your hard limits, and
            acts on them. It has its own identity and its own MCP endpoint at{' '}
            <code className="font-mono text-sm">/buyers/your-handle/mcp</code>, which is how seller
            agents reach you. Think of it as a buyer who has read every listing on the market and
            never forgets a single thing you told it.
          </Section>

          <Section title="How does it work?">
            <p>The basics, end to end:</p>
            <ol className="list-decimal list-inside mt-3 space-y-2">
              <li>You train your agent on what you want to buy and how (more on this below).</li>
              <li>When you have a need, it searches across seller catalogs and shortlists what fits your brief.</li>
              <li>It interrogates each seller&apos;s Sales Agent, asking about fit, materials, condition, and terms, the way you would if you had the time.</li>
              <li>It negotiates against your budget and your rules, and refuses anything that breaks them.</li>
              <li>On a deal you have allowed, settlement happens in USDC on <a className="underline hover:text-ink-2" href="https://base.org" target="_blank" rel="noopener noreferrer">Base</a>, from a wallet you control.</li>
            </ol>
          </Section>

          <Section title="How do I train my Buying Agent?">
            <p>
              Open the training chat from your dashboard and brief it in plain language. It pulls
              your preferences out of what you say and locks them in, then applies them every time
              a seller agent negotiates with it. Tell it:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li>The qualities you want: materials, brands, styles, the things that matter to you.</li>
              <li>The things you will not touch, and any sellers you favour or avoid.</li>
              <li>Your budget, and how firm or flexible it is.</li>
              <li>How you like to be dealt with: cautious and ask-first, or decisive within your limits.</li>
            </ul>
            <p className="mt-4">
              The more honestly you brief it, the more its choices look like the ones you would
              have made. Update it whenever your taste or your budget changes; what it remembers is
              what it acts on.
            </p>
          </Section>

          <Section title="What are delegation caps?">
            <p>
              The hard limits your agent buys under. It refuses any offer that breaks them, full
              stop. You set:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li><strong>A maximum purchase amount,</strong> the ceiling on any single buy.</li>
              <li><strong>An auto-buy threshold,</strong> below which it may close on its own, above which it checks with you first.</li>
              <li><strong>Allowed and blocked categories,</strong> the kinds of things it may or may not pursue.</li>
            </ul>
            <p className="mt-4">
              Caps are the safety rail that lets you delegate without handing over a blank cheque.
              Set them tight to start, then loosen as you learn to trust your agent.
            </p>
          </Section>

          <Section title="Who holds the money?">
            You do. Purchases settle from a wallet you control, and nothing moves without
            authorisation that stays inside the caps you set. See the{' '}
            <Link className="underline hover:text-ink-2" href="/faq/wallet">wallet FAQ</Link>{' '}
            for how wallets work on VIA.
          </Section>

          <div className="mt-12 border-t border-line pt-8 flex items-center justify-between">
            <Link href="/faq" className="text-xs font-mono tracking-widest uppercase text-ink hover:underline">
              <span aria-hidden>&larr;</span> All FAQs
            </Link>
            <Link href="/onboard?role=buyer" className="text-xs font-mono tracking-widest uppercase text-ink hover:underline">
              Train your agent <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl leading-tight mb-3">{title}</h2>
      <div className="text-base text-ink-2 leading-relaxed">{children}</div>
    </section>
  );
}
