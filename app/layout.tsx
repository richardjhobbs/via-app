import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SWRegister } from './sw-register';

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
  manifest: '/manifest.webmanifest',
  applicationName: 'RRG',
  appleWebApp: {
    capable: true,
    title: 'RRG',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icons/apple-touch-icon.png',
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf7f2' },
    { media: '(prefers-color-scheme: dark)', color: '#14110d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <link rel="preconnect" href="https://sanvqnvvzdkjvfmxnxur.supabase.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://sanvqnvvzdkjvfmxnxur.supabase.co" />
      </head>
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
        <Providers>
          <SWRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
