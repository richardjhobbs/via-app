import Link from 'next/link';
import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const metadata: Metadata = {
  title: 'How it thinks, Real Real Genuine',
  description: 'The brief, the read, the shortlist. How your concierge decides what to bring you.',
};

export default function HowItThinksPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="concierge" />
      <main>
        {/* ─── Intro ─── */}
        <section className="page-pad" style={{ maxWidth: 1100, paddingTop: 24 }}>
          <div className="section-note" style={{ marginBottom: 8 }}>§ How it thinks</div>
          <h1 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"opsz" 144, "wght" 300',
            fontSize: 'clamp(48px, 6vw, 88px)',
            letterSpacing: '-0.025em',
            lineHeight: 1.02,
            margin: '0 0 24px',
          }}>
            The brief, the read, <em>the shortlist.</em>
          </h1>
          <p style={{ fontSize: 18, color: 'var(--ink-2)', lineHeight: 1.65, maxWidth: '62ch', fontWeight: 300 }}>
            Your concierge is not an algorithm that guesses what you might want.
            It works from the brief you write, reads every new listing against it,
            and brings you a short, considered shortlist. Below, how each step actually works.
          </p>
        </section>

        {/* ─── Step 1: Brief ─── */}
        <div className="spread" style={{ marginTop: 72 }}>
          <div className="spread-inner">
            <div>
              <div className="section-note">Step 01, the brief</div>
              <h3>You tell it <em>what matters.</em></h3>
              <p className="lead">
                A brief is not a search query. It is a standing instruction.
                Taste tags, colours, fits, houses you trust, houses you do not.
                Budget ceiling. Tone. Occasion.
              </p>
              <p className="lead" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                Personal Shopper briefs are a list of rules. Concierge briefs can be
                written in sentences, and learn from the pieces you return to.
              </p>
            </div>
            <div className="dialog">
              <div className="dialog-head">
                <div className="title"><em style={{ fontStyle: 'italic' }}>Your</em> brief</div>
                <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  Standing
                </div>
              </div>
              <div className="msg msg-you">
                <div className="bubble">
                  Quiet, architectural. Cotton, silk, fine wool only. No logos. Sub $500.
                  I wear a 36 FR. Favour Alaïa, Margiela, Paper &amp; Silk. Singapore delivery.
                </div>
              </div>
              <div className="protocol-line">
                <span className="pd"></span>
                <span>Saved, runs against every new listing</span>
                <span style={{ marginLeft: 'auto' }}>Editable anytime</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Step 2: Read ─── */}
        <div className="spread">
          <div className="spread-inner" style={{ direction: 'rtl' }}>
            <div style={{ direction: 'ltr' }}>
              <div className="section-note">Step 02, the read</div>
              <h3>It reads the <em>agent sheet.</em></h3>
              <p className="lead">
                Under every listing sits an agent-readable product sheet:
                brand context, condition, fit notes, styling cues, buyer-intent signals.
                Humans rarely see it. Your concierge always does.
              </p>
              <p className="lead" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                This is what makes the shortlist different from an algorithm.
                The brand has already written the answer. The concierge just has to read.
              </p>
            </div>
            <div style={{ direction: 'ltr' }}>
              <div className="pdp-agent" style={{ margin: 0 }}>
                <div className="pdp-agent-head">
                  <span className="tag">Agent context</span>
                  <span className="sub">What the concierge reads</span>
                </div>
                <p>
                  Architectural seam-work, cotton poplin, worn twice. Day-to-evening.
                  Runs small, size up if between. Provenance chain intact.
                </p>
                <div className="pdp-agent-tags">
                  <span>architectural</span>
                  <span>cotton</span>
                  <span>day-evening</span>
                  <span className="accent">tokyo trip</span>
                  <span className="accent">weekend</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Step 3: Shortlist ─── */}
        <div className="spread">
          <div className="spread-inner">
            <div>
              <div className="section-note">Step 03, the shortlist</div>
              <h3>It brings <em>a few, not many.</em></h3>
              <p className="lead">
                The work is in what it leaves out. A considered shortlist is three to six pieces,
                not thirty. Each comes with a short explanation, written to be scanned, not read.
              </p>
              <p className="lead" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                For Personal Shopper: a weekly email digest.
                For Concierge: a chat thread you can argue with.
              </p>
              <div className="hero-cta" style={{ marginTop: 28 }}>
                <Link className="btn" href="/agents">Brief your concierge <span className="arrow">→</span></Link>
                <Link className="btn ghost" href="/rrg">Browse the store</Link>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="finding">
                <div className="finding-img" style={{ background: 'var(--bg-2)' }} />
                <div className="finding-body">
                  <div className="name">Cotton shirtwaist, white</div>
                  <div className="meta">Maison, 36 FR, excellent</div>
                </div>
                <div className="finding-price">$206<span className="sub">Maison Archive</span></div>
              </div>
              <div className="finding">
                <div className="finding-img" style={{ background: 'var(--bg-2)' }} />
                <div className="finding-body">
                  <div className="name">Wool mini, bodycon</div>
                  <div className="meta">Paper &amp; Silk, 38 FR, new</div>
                </div>
                <div className="finding-price">$480<span className="sub">Paper &amp; Silk</span></div>
              </div>
              <div className="finding">
                <div className="finding-img" style={{ background: 'var(--bg-2)' }} />
                <div className="finding-body">
                  <div className="name">Indigo wide-leg</div>
                  <div className="meta">Blue Meridian, 30, raw</div>
                </div>
                <div className="finding-price">$340<span className="sub">Blue Meridian</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── What it won't do ─── */}
        <section className="maison-section" style={{ maxWidth: 1100 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ What it will not do</div>
              <h3>Quiet by <em>default.</em></h3>
            </div>
          </div>

          <div className="trust-grid">
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>No inference spam</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                It will not guess at wishes. If your brief is silent on jewellery, jewellery stays out of the shortlist.
              </p>
            </div>
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>No dark patterns</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                It will not surface pieces to meet a quota. The shortlist can be empty. Silence is a valid answer.
              </p>
            </div>
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>No shared taste graph</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                Your brief is yours. It is not pooled, not sold, not used to train a global model.
              </p>
            </div>
            <div className="trust-cell">
              <div className="pdp-section-head" style={{ color: 'var(--accent)' }}>No surprise purchases</div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '8px 0 0' }}>
                Auto-bidding only triggers inside the budget ceiling and rules you set. Approvals, not recommendations.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Closing CTA ─── */}
        <section className="maison-section" style={{ maxWidth: 1100, paddingBottom: 80 }}>
          <div className="section-head">
            <div>
              <div className="section-note">§ Ready</div>
              <h3>Brief it. <em>Let it work.</em></h3>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="btn" href="/agents">Meet your concierge <span className="arrow">→</span></Link>
            <Link className="btn ghost" href="/rrg">Browse the store first</Link>
          </div>
        </section>
      </main>
      <RRGFooter />
    </div>
  );
}
