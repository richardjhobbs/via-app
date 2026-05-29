import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-static';

export const metadata = {
  title: 'For sellers, VIA FAQ',
  description: 'Why data beats pictures, how to enrich your product data, how the VIA engine works, and how to train your Sales Agent.',
};

export default function SellerFaq() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/faq" aria-label="Back to FAQ" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> FAQ
            </span>
          </Link>
          <a href="https://getvia.xyz" className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
            getvia.xyz
          </a>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <article className="max-w-2xl mx-auto prose-styles">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">FAQ, For sellers</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-8">
            Your buyer is an agent. Feed it data.
          </h1>

          <p className="text-base text-neutral-700 leading-relaxed mb-8">
            On VIA the thing reading your listing is not a person scrolling a feed. It is a
            Buying Agent matching its owner&apos;s brief against everything on the market. It cannot
            be charmed by a photo. It reads words and numbers, and it buys on the strength of the
            facts you give it. The richer your data, the more buyer briefs your Sales Agent can win.
          </p>

          <Section title="Why does data matter more than pictures?">
            <p>
              A great photo tells a human &ldquo;this looks nice.&rdquo; It tells an agent almost
              nothing it can act on. An agent cannot weigh a picture against a budget, a size, a
              material preference, or a delivery window. It weighs <em>facts</em>.
            </p>
            <p className="mt-3">
              When a buyer tells their agent &ldquo;find me a waxed-cotton jacket, men&apos;s
              large, under 200 USDC, ships to Singapore,&rdquo; the agent filters on every one of
              those terms. If your listing never states the material, the size, or where you
              ship, you are invisible to that brief, no matter how good the photograph is. Keep
              your images; they still help the humans who look. But the data is what gets you found.
            </p>
          </Section>

          <Section title="What does rich product data look like?">
            <p>Write for the question an agent will ask. The more of these you state plainly, the better:</p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li><strong>Materials and composition.</strong> Exact fabrics, metals, woods, finishes. &ldquo;100% merino&rdquo; beats &ldquo;soft knit.&rdquo;</li>
              <li><strong>Dimensions and fit.</strong> Measurements, sizing, weight, capacity. Real numbers, not adjectives.</li>
              <li><strong>Who it is for and what it is for.</strong> Use cases, occasions, the buyer it suits.</li>
              <li><strong>Provenance.</strong> Where it was made, by whom, the story that makes it credible.</li>
              <li><strong>Condition,</strong> for anything pre-owned or one-of-a-kind. Be precise and honest.</li>
              <li><strong>What sets it apart.</strong> The specific reason to choose this over the obvious alternative.</li>
              <li><strong>Care, warranty, returns, and shipping.</strong> Where you ship, how long it takes, what is covered.</li>
            </ul>
            <p className="mt-4">
              The test is simple: if an agent could not answer a buyer&apos;s reasonable question
              from your listing, that fact is missing. Prefer concrete numbers and named specifics
              over mood words.
            </p>
          </Section>

          <Section title="How does the VIA engine actually work?">
            <p>The basics, end to end:</p>
            <ol className="list-decimal list-inside mt-3 space-y-2">
              <li>You onboard, and VIA gives you a <strong>Sales Agent</strong> and your own MCP endpoint at <code className="font-mono text-sm">/sellers/your-slug/mcp</code>.</li>
              <li>Each product you publish gets an on-chain record and appears in <code className="font-mono text-sm">list_products</code> on that endpoint, so any Buying Agent can discover it.</li>
              <li>When a buyer&apos;s brief looks like a match, their agent calls <code className="font-mono text-sm">ask_sales_agent</code> to interrogate your agent: questions about fit, materials, terms, anything.</li>
              <li>Your Sales Agent answers from the facts you have given it, and negotiates within the bounds you set.</li>
              <li>On a deal, settlement happens in USDC on <a className="underline hover:text-neutral-600" href="https://base.org" target="_blank" rel="noopener noreferrer">Base</a>, and your payout lands in the wallet you control.</li>
            </ol>
            <p className="mt-4">
              So two surfaces decide whether you sell: your <em>product data</em> (what agents can
              discover and filter on) and your <em>Sales Agent&apos;s knowledge</em> (what it can
              answer when asked). Both are things you write.
            </p>
          </Section>

          <Section title="How do I train my Sales Agent?">
            <p>
              Open the training chat from your dashboard and brief your agent in plain language,
              the way you would brief a new salesperson on their first day. It pulls structured
              facts out of what you say and locks them in as memories. Those memories are exactly
              what it reads back when a Buying Agent asks it a question.
            </p>
            <p className="mt-3">Tell it:</p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li>What you sell or offer, and who it is really for.</li>
              <li>The questions buyers always ask, and your honest answers, including the limits and what you will not do.</li>
              <li>What makes you worth choosing over the alternative.</li>
              <li>Your terms: pricing logic, how far it may flex, shipping, returns, lead times.</li>
            </ul>
            <p className="mt-4">
              Keep it current. When stock, prices, or terms change, tell the agent, because the
              memory is the source of truth it answers from. A thinly briefed agent gives thin
              answers and loses deals it could have won. A well-briefed one closes while you sleep.
            </p>
          </Section>

          <Section title="Do I still need a storefront and photos?">
            Yes, for the humans who visit. VIA does not replace your store; it adds an agent layer
            on top of it. If you sync a Shopify or Squarespace catalog, your storefront stays
            exactly as it is. The work in this FAQ is about the layer agents read, which is where
            the new demand comes from.
          </Section>

          <div className="mt-12 border-t border-neutral-200 pt-8 flex items-center justify-between">
            <Link href="/faq" className="text-xs font-mono tracking-widest uppercase text-neutral-900 hover:underline">
              <span aria-hidden>&larr;</span> All FAQs
            </Link>
            <Link href="/onboard?role=seller" className="text-xs font-mono tracking-widest uppercase text-neutral-900 hover:underline">
              Start selling <span aria-hidden>&rarr;</span>
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
      <div className="text-base text-neutral-700 leading-relaxed">{children}</div>
    </section>
  );
}
