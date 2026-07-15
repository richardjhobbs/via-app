import type { ReactNode } from 'react';
import { Newsreader, Source_Sans_3 } from 'next/font/google';
import { InstallPrompt } from '@/components/backroom/InstallPrompt';

// The Back Room's own typography, deliberately away from the Maison/RRG
// system. Editorial serif for names and objects, humanist sans for
// functional text. Loaded only inside this route group so the fonts and the
// skin stay isolated from the rest of the app.
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

// A distinct installable identity for the Back Room, layered on the app-wide
// "VIA" PWA. Next merges metadata down the segment tree, so overriding manifest
// + appleWebApp here gives /backroom, /room, /you, /door their own launch app
// ("The Back Room") while the rest of the app keeps the root's "VIA" manifest.
export const metadata = {
  title: 'The Back Room · VIA',
  applicationName: 'The Back Room',
  manifest: '/backroom.webmanifest',
  appleWebApp: { capable: true, title: 'The Back Room', statusBarStyle: 'default' as const },
  icons: { apple: '/icons/backroom/apple-touch-icon.png' },
};

export default function BackRoomLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-skin="backroom"
      className={`${newsreader.variable} ${sourceSans.variable}`}
      style={{ minHeight: '100vh' }}
    >
      {children}
      <InstallPrompt />
    </div>
  );
}
