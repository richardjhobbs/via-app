import Link from 'next/link';
import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const metadata: Metadata = {
  title: 'Apply as a brand, Real Real Genuine',
  description: 'Admitted brands sell on RRG as an agent-native commerce channel. New collections, archive pieces, or hand-curated edits, each with an agent-readable product sheet.',
};

const CONTACT_EMAIL = 'contact@getvia.xyz';
const ONBOARDING_PATH = '/brands';

export default function ApplyAsBrandPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="store" />

      <main>
        {/* ─── Hero ─── */}
        <section className="page-pad" style={{ maxWidth: 1100, paddingTop: 24, paddingBottom: 32 }}>
          <div className="section-note" style={{ marginBottom: 8 }}>§ Apply as a brand</div>
          <h1 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"opsz" 144, "wght" 300',
            fontSize: 'clamp(44px, 5.6vw, 80px)',
            letterSpacing: '-0.025em',
            lineHeight: 1.02,
            margin: '0 0 24px',
          }}>
            A fashion-first channel for <em>admitted brands.</em>
          </h1>
          <p style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.65, maxWidth: '62ch', fontWeight: 300, marginBottom: 28 }}>
            Real Real Genuine is a quiet, curated boutique that sells to two audiences at once,
            human collectors and the AI concierges they rely on. Admitted brands list new
            collections, archive pieces, or hand-curated edits. Each piece carries an agent-readable
            product sheet, so when an agent reads your listing, it reads the answer you wrote.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={ONBOARDING_PATH} className="btn accent">
              Start your application <span className="arrow">→</span>
            </a>
            <Link href="/rrg" className="btn ghost">See the store</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 14, fontFamily: 'var(--font-jetbrains), monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Or email <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>{CONTACT_EMAIL}</a> for a warm intro.
          </p>
        </section>

        {/* ─── What you get ─── */}
        <section className="maison-section" style={{ maxWidth: 1100 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ 01, what you get</div>
              <h3>A storefront, <em>agent-ready.</em></h3>
            </div>
          </div>

          <div className="collab-inner" style={{ padding: 0 }}>
            <div className="collab-card" style={{ minHeight: 0, padding: '32px 32px 28px' }}>
              <div className="tag-line">
                <span className="uc-mono" style={{ color: 'var(--accent)' }}>Dedicated storefront</span>
              </div>
              <div>
                <h4 style={{ fontSize: 26, marginBottom: 10 }}>Your own house.</h4>
                <p>
                  Your brand lives at <code style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13, color: 'var(--accent)' }}>realrealgenuine.com/brand/yours</code>.
                  Full cover hero, lookbook, brief, links to your own site and socials.
                </p>
              </div>
            </div>

            <div className="collab-card" style={{ minHeight: 0, padding: '32px 32px 28px' }}>
              <div className="tag-line">
                <span className="uc-mono" style={{ color: 'var(--accent)' }}>Agent surface</span>
              </div>
              <div>
                <h4 style={{ fontSize: 26, marginBottom: 10 }}>Read by every concierge.</h4>
                <p>
                  Every listing carries an agent-readable product sheet. When a collector's
                  concierge runs a brief, your piece is in the candidate set, with the context
                  you wrote.
                </p>
              </div>
            </div>
          </div>

          <div className="collab-inner" style={{ padding: 0, marginTop: 16 }}>
            <div className="collab-card" style={{ minHeight: 0, padding: '32px 32px 28px' }}>
              <div className="tag-line">
                <span className="uc-mono" style={{ color: 'var(--accent)' }}>Shopify sync</span>
              </div>
              <div>
                <h4 style={{ fontSize: 26, marginBottom: 10 }}>Bring your stock.</h4>
                <p>
                  Admitted brands can mirror a Shopify catalogue into RRG. Stock, variants and
                  prices stay in sync, orders flow back into your fulfilment pipeline.
                </p>
              </div>
            </div>

            <div className="collab-card" style={{ minHeight: 0, padding: '32px 32px 28px' }}>
              <div className="tag-line">
                <span className="uc-mono" style={{ color: 'var(--accent)' }}>Co-creator briefs</span>
              </div>
              <div>
                <h4 style={{ fontSize: 26, marginBottom: 10 }}>Run a creative channel.</h4>
                <p>
                  Open briefs to the vetted creator pool. Approved work becomes a limited edition
                  tied to your brand, on-chain, with revenue split automatically.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section className="maison-section" style={{ maxWidth: 1100 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ 02, how it works</div>
              <h3>Four steps, <em>quietly.</em></h3>
            </div>
          </div>

          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <StepRow
              n="01"
              title="Apply."
              body={<>Start the onboarding flow at <a href={ONBOARDING_PATH} style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>realrealgenuine.com/brands</a>, or email <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>{CONTACT_EMAIL}</a> with a short note. We read every application.</>}
            />
            <StepRow
              n="02"
              title="Onboard."
              body="If we are a fit, we will onboard the brand together. Cover imagery, headline, description, wallet for payouts, Shopify link if applicable. Everything is reviewable before anything goes live."
            />
            <StepRow
              n="03"
              title="List."
              body="Your first pieces go up in the lookbook and on your dedicated storefront. You keep full editorial control over copy, imagery, and pricing."
            />
            <StepRow
              n="04"
              title="Operate."
              body="Sales pay out to your wallet in USDC. Open co-creator briefs when you want to commission work. Run it lightly, or run it seriously. The ceiling is yours."
            />
          </ol>
        </section>

        {/* ─── Who we take ─── */}
        <section className="maison-section" style={{ maxWidth: 1100 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ 03, who we take</div>
              <h3>Vetted, not <em>open to list.</em></h3>
            </div>
          </div>

          <div className="trust-grid">
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>Heritage labels</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                Houses with a back catalogue worth re-reading. Archive pieces, seasonal drops, collaborations.
              </p>
            </div>
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>Independent studios</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                Small houses with a distinct voice. Considered output over large inventory.
              </p>
            </div>
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>Curators &amp; archives</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                Hand-curated edits, vintage and provenance-led. The editor is the asset.
              </p>
            </div>
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>Fine jewellery</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                Workshops and houses working in precious materials, with documentation to match.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Commercials ─── */}
        <section className="maison-section" style={{ maxWidth: 1100 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ 04, commercials</div>
              <h3>Simple, <em>transparent.</em></h3>
            </div>
          </div>

          <div className="pdp-agent" style={{ margin: 0 }}>
            <div className="pdp-agent-head">
              <span className="tag">At a glance</span>
              <span className="sub">Full terms discussed during onboarding</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14, lineHeight: 2 }}>
              <FactRow label="Listing fee" body="None. You only pay when pieces sell." />
              <FactRow label="Rev share" body="Brand keeps the majority. Platform cut discussed during onboarding." />
              <FactRow label="Payouts" body="USDC on Base, automatic on sale. No invoicing." />
              <FactRow label="Co-creation" body="Creator share fixed, revenue split automatic, on-chain." />
              <FactRow label="Exit" body="30 days written notice, both ways. No lock-in." />
            </ul>
          </div>
        </section>

        {/* ─── FAQ ─── */}
        <section className="maison-section" style={{ maxWidth: 1100 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ 05, questions</div>
              <h3>Common <em>questions.</em></h3>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxWidth: 780 }}>
            <FAQ q="Do you take new-season collections, or only archive?" a="Both. Admitted brands can list new-season drops, archive pieces, or a mix. The common thread is editorial curation, not format." />
            <FAQ q="What do I need to apply?" a="A short note on the brand, links to your current work, and a sense of what you would list first. We will take it from there." />
            <FAQ q="Can I keep selling on my own site?" a="Yes. RRG is a channel, not a platform lock-in. Many brands mirror their Shopify catalogue here and keep their main site as-is." />
            <FAQ q="What happens if an AI agent buys something?" a="The same as a human buying. Payment in USDC, order lands in your fulfilment pipeline, you ship. Agents identify themselves via ERC-8004 signals, so you get full trust context on the buyer." />
            <FAQ q="Who owns my customer relationship?" a="You do. RRG is a storefront, not a loyalty layer. Orders come with buyer email and shipping details where applicable." />
          </div>
        </section>

        {/* ─── Closing CTA ─── */}
        <section className="maison-section" style={{ maxWidth: 1100, paddingBottom: 80 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ Apply</div>
              <h3>Ready? <em>Send a note.</em></h3>
            </div>
          </div>
          <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.65, maxWidth: '52ch', fontWeight: 300, margin: '0 0 20px' }}>
            Start the onboarding flow below. A few steps to stand up your brand, your wallet
            for payouts, and your first pieces. We review every application.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={ONBOARDING_PATH} className="btn accent">
              Start your application <span className="arrow">→</span>
            </a>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Applying%20as%20a%20brand`} className="btn ghost">
              Email {CONTACT_EMAIL}
            </a>
          </div>
        </section>
      </main>

      <RRGFooter />
    </div>
  );
}

function StepRow({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: 'minmax(60px, auto) 1fr', gap: 24, alignItems: 'flex-start', padding: '24px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{
        fontFamily: 'var(--font-fraunces), serif',
        fontVariationSettings: '"opsz" 144, "wght" 300',
        fontSize: 48,
        lineHeight: 1,
        color: 'var(--accent)',
        letterSpacing: '-0.02em',
      }}>
        {n}
      </span>
      <div>
        <h4 style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: 24,
          fontWeight: 400,
          letterSpacing: '-0.01em',
          margin: '0 0 8px',
        }}>
          {title}
        </h4>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0, maxWidth: '62ch', fontWeight: 300 }}>
          {body}
        </p>
      </div>
    </li>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '20px 0' }}>
      <h4 style={{
        fontFamily: 'var(--font-fraunces), serif',
        fontSize: 18,
        fontWeight: 400,
        letterSpacing: '-0.01em',
        margin: '0 0 8px',
      }}>
        {q}
      </h4>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.65, margin: 0, fontWeight: 300 }}>
        {a}
      </p>
    </div>
  );
}

function FactRow({ label, body }: { label: string; body: string }) {
  return (
    <li style={{ display: 'flex', gap: 12 }}>
      <span style={{
        minWidth: 140,
        color: 'var(--ink-3)',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{ color: 'var(--ink)' }}>{body}</span>
    </li>
  );
}
