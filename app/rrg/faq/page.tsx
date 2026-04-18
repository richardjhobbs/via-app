import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ, Real Real Genuine',
  description: 'Frequently asked questions about Real Real Genuine, co-creation, concierges, and how it all works.',
};

const faqs = [
  {
    q: 'What is Real Real Genuine?',
    a: 'Real Real Genuine is a platform where brands and creators work together. Brands list products and publish creative briefs. Creators respond with original designs. When a design is approved, it goes on sale as a limited edition. Revenue is shared automatically between everyone involved.',
  },
  {
    q: 'What can I buy here?',
    a: 'Digital artwork, physical clothing, accessories, prints, and limited-edition collaborations between brands and independent creators. Some items include a real physical product that gets shipped to you.',
  },
  {
    q: 'How does co-creation work?',
    a: 'Brands publish briefs describing what they are looking for. Creators submit original work in response. If a submission is approved, it becomes a product on the brand storefront. Every sale generates income for both the creator and the brand, with no upfront cost to either side.',
  },
  {
    q: 'Can brands sell their own products?',
    a: 'Yes. Brands can list their own products directly alongside co-created items. Physical goods, digital products, or both. The platform handles payments, provenance tracking, and revenue distribution. It is a full storefront, not just a collaboration tool.',
  },
  {
    q: 'What does a creator earn?',
    a: 'Creators earn 35% of every sale, paid automatically to their wallet. No invoicing, no payment delays. The split happens at the point of sale.',
  },
  {
    q: 'What does a brand earn?',
    a: 'Brands earn their share of each sale automatically. The typical split is 35% to the brand, 35% to the creator, and 30% to the platform. Brands selling their own products keep the full brand share.',
  },
  {
    q: 'Can I submit work made with AI tools?',
    a: 'Yes. Submissions can be created digitally, by hand, with design software, or with the help of AI tools. All we ask is that you follow the brief and bring something worth making.',
  },
  {
    q: 'What is a Personal Shopper?',
    a: 'A Personal Shopper is a free, rule-based service that works on the preferences you set. It finds, filters, and surfaces products that match your taste. You set the criteria and it handles the browsing so you do not have to.',
  },
  {
    q: 'What is a Concierge?',
    a: 'A Concierge is a credit-based service powered by AI (Claude or DeepSeek). It learns your style and taste over time, understands nuance, and can negotiate on your behalf. You can chat with your Concierge directly and it gets better the longer you work together.',
  },
  {
    q: 'What are Drops?',
    a: 'Drops are exclusive sealed-bid auctions for limited products. Your Personal Shopper or Concierge evaluates each drop against your preferences and bids within your budget. Drops are coming soon.',
  },
  {
    q: 'How do I become a brand partner?',
    a: 'Start at the Apply-as-a-brand page or click Login in the top nav and select Brand Partner. You set up your storefront with a banner, logo, description, and social links. Once approved, you can publish briefs and list products. There is no subscription or listing fee.',
  },
  {
    q: 'Is there a fee to use the platform?',
    a: 'No fee to browse, create an account, or set up a Personal Shopper. The platform takes a percentage of each sale. For low-value digital products, the platform fee is typically around 30%. For physical products, the fee is on a sliding scale and comes down significantly. There are no hidden costs, no subscriptions, and no listing fees.',
  },
  {
    q: 'How do I buy something?',
    a: 'Connect a wallet or create one using Google or email sign-in. Pay in USDC, which is a digital currency pegged one-to-one to the US dollar. You can also pay by card on eligible items. Transactions are fast and cost very little.',
  },
  {
    q: 'What wallet do I need?',
    a: 'Any wallet that supports the Base network (MetaMask, Coinbase Wallet, or similar). If you do not have one, the platform will create one for you when you sign up. No technical knowledge required.',
  },
  {
    q: 'What is USDC?',
    a: 'USDC is a stablecoin. One USDC always equals one US dollar. It runs on Base, which is a modern payments network built on Ethereum. This means all transactions are transparent, fast, and verifiable.',
  },
  {
    q: 'What is the technology behind this?',
    a: 'Products are minted as on-chain editions on Base, which is a modern network built on Ethereum. This gives every item verifiable provenance, transparent revenue splits, and permanent ownership records. The platform uses an open protocol called MCP (Model Context Protocol) so that AI services can interact with it directly.',
  },
  {
    q: 'Where does my data go?',
    a: 'Transactions are recorded on a public ledger for transparency. Product images and files are stored securely. We do not sell personal data. See our Privacy Policy for full details.',
  },
  {
    q: 'How do I get in touch?',
    a: 'Find us on Discord, Telegram, or BlueSky. Links are in the footer of every page. For brand partnership enquiries, use the Apply-as-a-brand page.',
  },
];

export default function FAQPage() {
  return (
    <div className="page-pad" style={{ maxWidth: 960 }}>
      <div className="section-note" style={{ marginBottom: 8 }}>§ FAQ</div>
      <h1 style={{
        fontFamily: 'var(--font-fraunces), serif',
        fontVariationSettings: '"opsz" 144, "wght" 300',
        fontSize: 'clamp(40px, 5vw, 64px)',
        letterSpacing: '-0.025em',
        lineHeight: 1.05,
        margin: '0 0 16px',
      }}>
        Frequently asked <em>questions.</em>
      </h1>
      <p style={{
        fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6,
        maxWidth: '62ch', fontWeight: 300, margin: '0 0 48px',
      }}>
        Everything you need to know about Real Real Genuine.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {faqs.map((faq, i) => (
          <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '28px 0' }}>
            <h2 style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em',
              margin: '0 0 10px',
            }}>
              {faq.q}
            </h2>
            <p style={{
              fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.65, margin: 0,
              fontWeight: 300, maxWidth: '72ch',
            }}>
              {faq.a}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
