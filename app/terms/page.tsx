import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const metadata: Metadata = {
  title: 'Terms of Service, Real Real Genuine',
};

const sections = [
  { num: '01', title: 'What is RRG?', content: 'Real Real Genuine is a platform where you can purchase limited-edition digital and physical products. Each digital product is minted on-chain as an ERC-1155 token on Base and paid for in USDC.' },
  { num: '02', title: 'What you are buying', content: 'When you purchase a product on RRG, you receive:', list: ['An on-chain token representing your edition', 'Access to download any digital files attached to that product', 'Proof of ownership recorded on the Base blockchain'], after: 'Some products include physical items that will be shipped to you. Details are listed on each product page.' },
  { num: '03', title: 'Payments', content: 'All prices are listed in USDC. Payment is made via your connected wallet. Once a transaction is confirmed on-chain, the purchase is final.' },
  { num: '04', title: 'Refunds', content: 'Because products are delivered instantly as on-chain tokens, refunds are not available. If you experience a technical issue with delivery, contact us and we will work to resolve it.' },
  { num: '05', title: 'Your rights as a buyer', content: 'You own your edition. You may hold, display, or transfer your token. You may not:', list: ['Reproduce or redistribute the attached digital files', 'Claim authorship of the underlying design or artwork', 'Use the product for commercial purposes unless the product listing explicitly permits it'] },
  { num: '06', title: 'Editions and availability', content: 'Each product has a fixed edition size set by the creator and brand partner. Once all editions are sold, no more will be minted. Edition sizes cannot be changed after the first sale.' },
  { num: '07', title: 'Wallet responsibility', content: 'You are responsible for your own wallet, private keys, and any transactions you authorise. RRG cannot recover lost tokens or reverse on-chain transactions.' },
  { num: '08', title: 'Limitation of liability', content: 'RRG is provided as-is. To the fullest extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the platform or any purchased product.' },
  { num: '09', title: 'Changes to terms', content: 'We may update these terms. The latest version is always available at this page. Continued use of RRG after changes constitutes acceptance.' },
  { num: '10', title: 'Brand partners and creators', content: 'Separate terms apply to brand partners and creators who publish products on RRG. These are available on request, contact contact@realrealgenuine.com', highlight: true },
  { num: '11', title: 'Contact', content: 'Questions about these terms or your purchase? Reach us at contact@realrealgenuine.com' },
];

export default function TermsPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader />
      <main>
        <section className="page-pad" style={{ maxWidth: 880, paddingTop: 24 }}>
          <div className="section-note" style={{ marginBottom: 8 }}>§ Legal</div>
          <h1 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"opsz" 144, "wght" 300',
            fontSize: 'clamp(40px, 5vw, 64px)',
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
            margin: '0 0 12px',
          }}>
            Terms of <em>Service.</em>
          </h1>
          <p style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--ink-3)', margin: '0 0 48px',
          }}>
            Last updated 12 March 2026
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {sections.map((s) => (
              <div key={s.num} style={{ borderTop: '1px solid var(--line)', padding: '28px 0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(44px, auto) 1fr', gap: 24, alignItems: 'flex-start' }}>
                  <span style={{
                    fontFamily: 'var(--font-fraunces), serif',
                    fontSize: 28, lineHeight: 1,
                    color: 'var(--accent)', fontWeight: 300,
                    letterSpacing: '-0.02em',
                  }}>
                    {s.num}
                  </span>
                  <div>
                    <h2 style={{
                      fontFamily: 'var(--font-fraunces), serif',
                      fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em',
                      margin: '0 0 12px',
                    }}>
                      {s.title}
                    </h2>
                    <p style={{
                      fontSize: 15, lineHeight: 1.65, margin: 0,
                      color: 'var(--ink-2)', fontWeight: 300,
                      ...(s.highlight ? { borderLeft: '2px solid var(--accent)', paddingLeft: 14 } : {}),
                    }}>
                      {s.content}
                    </p>
                    {s.list && (
                      <ul style={{ margin: '10px 0 0', paddingLeft: 20, listStyle: 'none' }}>
                        {s.list.map((item, i) => (
                          <li key={i} style={{
                            position: 'relative', paddingLeft: 14,
                            fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.65,
                            fontWeight: 300, marginBottom: 4,
                          }}>
                            <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>·</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.after && (
                      <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.65, margin: '10px 0 0', fontWeight: 300 }}>
                        {s.after}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <RRGFooter />
    </div>
  );
}
