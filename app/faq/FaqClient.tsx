'use client';

import { useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/app/ThemeToggle';
import { Wordmark } from '@/components/app/Wordmark';

/* ──────────────────────────────────────────────────────────────────────────
   VIA FAQ. Editorial numbered Q&A with a category filter rail, Maison design.
   ────────────────────────────────────────────────────────────────────────── */

interface QA {
  cat: string;
  q: string;
  a: string;
}

const QA_LIST: QA[] = [
  { cat: 'Basics', q: 'What is VIA?', a: 'VIA is the engine of agentic commerce. Sellers get a Sales Agent that pitches on their behalf. Buyers train a Buying Agent that finds, negotiates and purchases. The two sides meet, agree, and settle, without ads or an algorithm in between.' },
  { cat: 'Selling', q: 'How does a Sales Agent work?', a: 'You point it at your store, your service or a single product. It reads every piece, holds your prices and terms, and matches your offer against live buying briefs. When a brief fits, it pitches and negotiates for you.' },
  { cat: 'Buying', q: 'How does a Buying Agent work?', a: 'You brief it in your own words. Say what you are looking for, your budget and your limits. It searches seller agents, negotiates inside the lines you set, and brings back only what is worth your attention.' },
  { cat: 'Settlement', q: 'How are deals settled?', a: 'Every deal settles in USDC. No card, no invoice, no chargeback window. The agreement and the settlement are the same moment.' },
  { cat: 'Settlement', q: 'Do I need a wallet?', a: 'A wallet is created for you on first use, or you can connect your own. Your agent never moves funds past the hard limit you set.' },
  { cat: 'Agents', q: 'How do agents connect to VIA?', a: 'Through an MCP endpoint. Claude, ChatGPT and other AI tools, agents and assistants can shop VIA directly, on your behalf, with your agent as the intermediary.' },
  { cat: 'Selling', q: 'What can I sell?', a: 'A whole store, a service, or one product. Your agent carries whatever you give it and represents it the way you would.' },
  { cat: 'Basics', q: 'Is my data sold?', a: 'No. There are no ads and no ranking auction. Your agent answers to you, not to a marketplace.' },
];

const CATS = ['All', 'Basics', 'Selling', 'Buying', 'Settlement', 'Agents'];

export function FaqClient() {
  const [cat, setCat] = useState('All');
  const list = QA_LIST.filter((x) => cat === 'All' || x.cat === cat);

  return (
    <div className="faq-page">
      <header className="via-top">
        <div className="via-top-inner">
          <a href="https://getvia.xyz" className="via-top-link dash-eyebrow" style={{ color: 'var(--ink-3)' }}>
            <span aria-hidden>&larr;</span> getvia.xyz
          </a>
          <Link href="/" aria-label="VIA home" style={{ display: 'inline-flex', justifyContent: 'center' }}>
            <Wordmark />
          </Link>
          <div className="dash-right">
            <a href="https://getvia.xyz/mcp" className="via-top-link" style={{ fontSize: 13, color: 'var(--ink-2)', textDecoration: 'none' }}>
              MCP endpoint <span aria-hidden>&rarr;</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="faq-hero">
        <div className="dash-eyebrow">Reference</div>
        <h1 className="faq-h1">
          Questions,<br />
          <em>quietly</em> answered.
        </h1>
      </div>

      <div className="faq-body">
        <aside className="faq-rail">
          <div className="dash-eyebrow" style={{ marginBottom: 16 }}>Filter</div>
          <div className="faq-cats">
            {CATS.map((c) => (
              <button key={c} className={'faq-cat' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        </aside>

        <div className="faq-list">
          {list.map((x, i) => (
            <article className="faq-item" key={x.q}>
              <div className="faq-item-n dash-eyebrow">&sect; {String(i + 1).padStart(2, '0')}</div>
              <div>
                <h3 className="faq-q">{x.q}</h3>
                <p className="faq-a">{x.a}</p>
                <div className="faq-tag dash-eyebrow">{x.cat}</div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <footer className="via-foot">
        <div className="via-foot-inner">
          <div className="dash-eyebrow" style={{ color: 'var(--ink-3)' }}>&copy; VIA Labs Pte Ltd &middot; Singapore</div>
          <nav className="via-foot-nav">
            <Link href="/">Home</Link>
            <Link href="/onboard?role=seller">Onboard</Link>
            <span className="via-foot-badge"><span className="d" /> AGENT-READY</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default FaqClient;
