import Link from 'next/link';
import { Wordmark } from '@/components/app/Wordmark';
import ThemeToggle from '@/components/app/ThemeToggle';

export const metadata = {
  title: 'How payment works, VIA FAQ',
  description: 'How to pay on VIA in plain language: wallets, paying by card, what USDC is, fees, and where your money goes.',
};

export default function PaymentFaq() {
  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home"><Wordmark /></Link>
          <div className="flex items-center gap-4">
            <a href="https://getvia.xyz" className="uc-mono text-ink-3 hover:text-ink transition-colors">
              getvia.xyz ↗
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <article className="max-w-2xl mx-auto prose-styles">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">FAQ, Payment</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-8">
            How payment works.
          </h1>

          <p className="text-base text-ink-2 leading-relaxed mb-8">
            Every purchase on VIA settles in USDC on the Base network. You pay from a wallet
            you control, by card or from a balance you already hold. Here is the whole thing in
            plain language.
          </p>

          <Section title="How do I pay?">
            Connect a wallet (or create one in seconds), then pay the price shown. You can pay
            straight from USDC in your wallet, or by card. The payment settles instantly and the
            seller is notified to fulfil your order.
          </Section>

          <Section title="What is USDC?">
            USDC is a digital dollar, a stablecoin. One USDC is worth about one US dollar. It moves
            instantly and the price you see is the price you pay, with no card fees added by VIA.
          </Section>

          <Section title="I do not have a wallet. What do I do?">
            Choose <strong>Create wallet</strong> and sign in with your email or Google. VIA makes a
            wallet for you that you control through that login, recovery works just like recovering
            your inbox. If you already have a wallet, choose <strong>Connect wallet</strong> to link
            MetaMask, Coinbase Wallet or WalletConnect.
          </Section>

          <Section title="Can I pay by credit or debit card?">
            Yes, on orders of 10 USDC or more. The card tops up your wallet with USDC, then the order
            settles from it. The funds land in your own wallet first, so anything left over stays
            yours. For amounts under 10 USDC, pay from a wallet that already holds USDC.
          </Section>

          <Section title="What network does VIA use, and are there fees?">
            Payments settle on <a className="underline hover:text-ink-2" href="https://base.org" target="_blank" rel="noopener noreferrer">Base</a>,
            a fast, low-fee Ethereum network from Coinbase. The seller receives the item price and
            VIA keeps a 2.5% network fee. There is no separate checkout fee.
          </Section>

          <Section title="Where does my money go?">
            When you pay, the seller is paid out their share (97.5%) and VIA keeps 2.5% to run the
            network. The seller is notified at once to fulfil and ship your order.
          </Section>

          <Section title="Is it safe?">
            You hold your own wallet. VIA cannot move your funds without your approval, you confirm
            each payment yourself. After checkout you get an order reference, keep it for any
            follow-up with the seller.
          </Section>

          <div className="mt-12 border-t border-line pt-8">
            <Link href="/" className="text-xs font-mono tracking-widest uppercase text-ink hover:underline">
              <span aria-hidden>←</span> Back to VIA
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
