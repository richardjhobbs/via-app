import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SWRegister } from './sw-register';
import { AppInstallPrompt } from '@/components/app/AppInstallPrompt';

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

const SITE_URL = 'https://app.getvia.xyz';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'VIA · Sales & Buying Agents',
  description: 'Onboard your business as a VIA seller, or train a personal Buying Agent. Agentic commerce settled in USDC on Base.',
  manifest: '/manifest.webmanifest',
  applicationName: 'VIA',
  appleWebApp: {
    capable: true,
    title: 'VIA',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    title: 'VIA · Sales & Buying Agents',
    description: 'Onboard your business as a VIA seller, or train a personal Buying Agent.',
    url: SITE_URL,
    siteName: 'VIA',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'VIA · Sales & Buying Agents',
    description: 'Onboard your business as a VIA seller, or train a personal Buying Agent.',
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
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so the page never flashes
            the wrong palette and the theme is correct even before the React
            ThemeToggle hydrates (matters on heavy, force-dynamic routes). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('rrg-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://gcxyoujubqclenrhhill.supabase.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://gcxyoujubqclenrhhill.supabase.co" />
      </head>
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
        <Providers>
          <SWRegister />
          {children}
          <AppInstallPrompt />
        </Providers>
      </body>
    </html>
  );
}
