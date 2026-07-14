'use client';

/**
 * A short, plain-language FAQ about taste cards, shown before someone makes one
 * (on /you) and to anyone who lands on a shared card or the /taste page. No
 * jargon: what it is, what is public, how connecting works.
 */
import { useState } from 'react';

const QA: { q: string; a: string }[] = [
  {
    q: 'What is a taste card?',
    a: 'A small, shareable page that says who you really are: what you do, where you are, and what you love. Not a CV, and not a feed. It is how the right people find you and how you find them.',
  },
  {
    q: 'What do other people see?',
    a: 'Only what you choose to publish. You build a private profile first, then pick the handful of things that go on the public card. The rest stays yours.',
  },
  {
    q: 'How do I make one?',
    a: 'You talk. Hold the button and answer a few questions out loud, and your words fill every field. Then pick what goes public, give it an address, and publish. You can edit any word by hand.',
  },
  {
    q: 'How do people connect?',
    a: 'Two ways. You can knock on someone\'s card to ask for an introduction, and they answer in their own time. Or VIA quietly suggests a few people a month whose profile genuinely overlaps with yours. Both sides always have to say yes.',
  },
  {
    q: 'Do I have to sell anything?',
    a: 'No. Most people are here to meet good people. If a connection turns into something you want to build and sell together, VIA has the tools for that too, but it is never required.',
  },
];

export function TasteFaq({ heading = 'New here? What a taste card is' }: { heading?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', margin: '0 0 24px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="br-sans"
        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', padding: '14px 16px', color: 'var(--ink)', fontSize: 15, textAlign: 'left' }}
      >
        <span>{heading}</span>
        <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 18 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          {QA.map(({ q, a }) => (
            <div key={q} style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
              <p className="br-serif" style={{ fontSize: 17, margin: '0 0 4px', color: 'var(--ink)' }}>{q}</p>
              <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>{a}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
