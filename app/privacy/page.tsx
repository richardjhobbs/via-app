import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const metadata: Metadata = {
  title: 'Privacy Policy, Real Real Genuine',
};

const sections = [
  { num: '01', title: 'What we collect', content: 'When you use RRG, we may collect:', list: ['Your wallet address (public, on-chain)', 'Transaction details (payment amount, token ID, timestamp)', 'Email address, if you choose to provide one', 'Style preferences and instructions you set for your Personal Shopper or Concierge'], after: 'We do not require an account or personal profile to browse or purchase.' },
  { num: '02', title: 'How we use your data', content: 'We use collected information to:', list: ['Process and deliver your purchases', 'Provide access to downloadable files attached to your product', 'Power your Personal Shopper or Concierge preferences and memory', 'Communicate about your order if needed', 'Improve the platform'] },
  { num: '03', title: 'On-chain data', content: 'Your wallet address and purchase transactions are recorded on the Base blockchain. This data is public and permanent by design, it is not controlled by RRG and cannot be deleted.' },
  { num: '04', title: 'Concierge data', content: 'If you use the Concierge service, your chat conversations and extracted preferences are stored to improve your experience over time. This data is linked to your agent account and can be deleted on request.' },
  { num: '05', title: 'Cookies', content: 'We use minimal cookies for essential site functionality (authentication sessions, preferences). We do not use third-party advertising or tracking cookies.' },
  { num: '06', title: 'Third-party services', content: 'We use third-party services for payment processing, file storage, LLM providers (for Concierge chat), and hosting. These providers are bound by their own privacy policies and process your data only as needed to deliver our service.' },
  { num: '07', title: 'Data security', content: 'We take reasonable steps to protect your information. However, no system is completely secure and we cannot guarantee absolute protection.' },
  { num: '08', title: 'Your rights', content: 'You may request access to, correction of, or deletion of your personal data (excluding on-chain records) by contacting us. We will respond in accordance with applicable law.' },
  { num: '09', title: 'Children', content: 'RRG is not directed at anyone under 16. We do not knowingly collect information from children.' },
  { num: '10', title: 'Changes', content: 'We may update this policy. The latest version is always available at this page.' },
  { num: '11', title: 'Contact', content: 'Questions about your privacy? Reach us at contact@realrealgenuine.com' },
];

export default function PrivacyPage() {
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
            Privacy <em>Policy.</em>
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
