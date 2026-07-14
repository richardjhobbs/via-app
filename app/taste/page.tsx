import type { Metadata } from 'next';
import Link from 'next/link';
import { TasteFaq } from '@/components/backroom/TasteFaq';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Taste cards · VIA',
  description: 'A better way to meet people who think like you. Say who you really are, in your own words, and find the few people worth knowing.',
  openGraph: {
    title: 'Taste cards on VIA',
    description: 'A better way to meet people who think like you. Say who you really are, and find the few people worth knowing.',
    type: 'website',
  },
  twitter: { card: 'summary', title: 'Taste cards on VIA', description: 'A better way to meet people who think like you.' },
};

// The public "what is this / get your own" landing. Where shared cards and the
// invite CTA point, so a first-time visitor can understand it and make one.
export default function TasteLanding() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 20px 120px' }}>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>VIA</p>
      <h1 className="br-serif" style={{ fontSize: 40, fontWeight: 400, margin: '10px 0 18px', lineHeight: 1.08 }}>
        Meet people who think like you
      </h1>
      <p className="br-sans" style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 16px' }}>
        Networking today is a numbers game: hundreds of contacts, almost none of them close.
        A taste card is the opposite. It says who you really are, what you do, where you are, and
        what you love, and it helps the few people worth knowing find you.
      </p>
      <p className="br-sans" style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 28px' }}>
        Connect, collaborate, and if you want to, build and sell something together. That last part
        is optional. Most people are just here to meet good people.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 36 }}>
        <Link href="/backroom" className="br-sans"
          style={{ display: 'inline-block', padding: '14px 28px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 15, textDecoration: 'none' }}>
          Make your card
        </Link>
        <Link href="/backroom" className="br-sans"
          style={{ display: 'inline-block', padding: '14px 28px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)', fontSize: 15, textDecoration: 'none' }}>
          Sign in
        </Link>
      </div>

      <TasteFaq heading="How it works" />
    </main>
  );
}
