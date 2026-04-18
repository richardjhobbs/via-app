import type { Metadata } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

const SITE_URL = 'https://realrealgenuine.com';

export const metadata: Metadata = {
  title: 'Real Real Genuine',
  description: 'A fashion-first commerce platform. Quietly agent-ready for the clients, concierges and curators who think ahead.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'Real Real Genuine',
    description: 'A fashion-first commerce platform. Quietly agent-ready for the clients, concierges and curators who think ahead.',
    url: SITE_URL,
    siteName: 'Real Real Genuine',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Real Real Genuine',
    description: 'A fashion-first commerce platform. Quietly agent-ready.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
