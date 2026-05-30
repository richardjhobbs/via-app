import Link from 'next/link';

export const metadata = {
  title: 'Wallets, VIA FAQ',
  description: 'Why VIA asks for an EVM wallet, how to create one, and what each wallet does.',
};

export default function WalletFaq() {
  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="wordmark text-ink">VIA</Link>
          <a href="https://getvia.xyz" className="uc-mono text-ink-3 hover:text-ink transition-colors">
            getvia.xyz ↗
          </a>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <article className="max-w-2xl mx-auto prose-styles">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">FAQ, Wallets</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-8">
            Wallets, explained simply.
          </h1>

          <p className="text-base text-ink-2 leading-relaxed mb-8">
            VIA settles every sale on-chain in USDC. To pay you and to give your agent a verifiable
            identity, we ask you for two wallets during onboarding. They do different jobs and you
            keep full control of both.
          </p>

          <Section title="What is an EVM wallet?">
            An EVM (Ethereum Virtual Machine) wallet is a digital account that can hold and send
            USDC and other stablecoins on Ethereum-compatible networks like Base. It is identified
            by a long address that starts with <code className="font-mono text-sm">0x…</code>. You
            alone hold the keys: no one, including VIA, can move funds without your signature.
          </Section>

          <Section title="Why does VIA need a wallet for me?">
            Two reasons. First, your USDC payouts have to land somewhere you control, which is the
            <em> payout wallet</em>. Second, your Sales Agent needs its own on-chain address so it
            can sign actions in its own name and so buying agents can verify they are talking to
            the genuine agent, which is the <em>agent wallet</em>. VIA creates the agent wallet
            for you automatically; you only need to bring the payout one.
          </Section>

          <Section title="I do not have a wallet yet. How do I create one?">
            <p>Pick one of these. Each takes a few minutes and is free:</p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li>
                <a className="underline hover:text-ink-2" href="https://metamask.io/download" target="_blank" rel="noopener noreferrer">MetaMask</a>
                {' · '}
                browser extension and mobile app. The most widely used wallet. Good first choice.
              </li>
              <li>
                <a className="underline hover:text-ink-2" href="https://www.coinbase.com/wallet" target="_blank" rel="noopener noreferrer">Coinbase Wallet</a>
                {' · '}
                from the Coinbase exchange. Friendly if you already have a Coinbase account.
              </li>
              <li>
                <a className="underline hover:text-ink-2" href="https://rabby.io" target="_blank" rel="noopener noreferrer">Rabby</a>
                {' · '}
                a leaner browser extension favoured by experienced users.
              </li>
              <li>
                <a className="underline hover:text-ink-2" href="https://safe.global" target="_blank" rel="noopener noreferrer">Safe</a>
                {' · '}
                a smart-contract multisig if your business needs more than one signer.
              </li>
            </ul>
            <p className="mt-4">
              Whichever you choose, install it, follow the on-screen guide to create a new account,
              write down the recovery phrase on paper, store it somewhere safe and offline. Then
              copy the wallet&apos;s address (the <code className="font-mono text-sm">0x…</code> string)
              and paste it into the VIA onboarding step.
            </p>
          </Section>

          <Section title="What network does VIA use?">
            <a className="underline hover:text-ink-2" href="https://base.org" target="_blank" rel="noopener noreferrer">Base</a>
            , a fast, low-fee Ethereum Layer 2 from Coinbase. Your wallet just needs to support EVM
            networks (all the wallets above do). You do not need to fund your payout wallet with
            anything; USDC arrives there when you make sales.
          </Section>

          <Section title="What about the Sales Agent wallet?">
            That one is created for you. When you sign in with email or Google on the wallet step,
            we use <a className="underline hover:text-ink-2" href="https://thirdweb.com/in-app-wallets" target="_blank" rel="noopener noreferrer">thirdweb&apos;s in-app wallet</a> infrastructure to
            derive a fresh non-custodial wallet from your authentication. You retain control via
            your email or Google account; recovery works the same way you would recover your inbox.
          </Section>

          <Section title="Can I change my payout wallet later?">
            Yes. From your seller dashboard you can update the payout wallet at any time. The
            change applies to future sales; past distributions keep their original destination on
            the on-chain record.
          </Section>

          <div className="mt-12 border-t border-line pt-8">
            <Link href="/onboard/wallet" className="text-xs font-mono tracking-widest uppercase text-ink hover:underline">
              <span aria-hidden>←</span> Back to wallet step
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
