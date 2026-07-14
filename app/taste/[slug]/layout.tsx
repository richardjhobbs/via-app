import type { ReactNode } from 'react';
import { Newsreader, Source_Sans_3 } from 'next/font/google';

// The public taste card lives outside the (backroom) route group but wears the
// same paper-and-ink skin, so the shared artifact and the room feel like one
// place. Fonts load here to keep them scoped, exactly as the group layout does.
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

export default function TasteCardLayout({ children }: { children: ReactNode }) {
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
