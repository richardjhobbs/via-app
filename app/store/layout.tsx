import type { ReactNode } from 'react';
import { Newsreader, Source_Sans_3 } from 'next/font/google';

// The public store card wears the same paper-and-ink skin as the taste card, so
// the shareable-card family looks like one system.
const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});
const sourceSans = Source_Sans_3({
  variable: '--font-source-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

export default function StoreCardLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-skin="backroom"
      className={`${newsreader.variable} ${sourceSans.variable}`}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      {children}
    </div>
  );
}
