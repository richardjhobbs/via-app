import type { ReactNode } from 'react';
import Link from 'next/link';
import { Newsreader, Source_Sans_3 } from 'next/font/google';
import { InstallPrompt } from '@/components/backroom/InstallPrompt';
import { primarySessionMember } from '@/lib/app/backroom/ui-auth';

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

export default async function BackRoomLayout({ children }: { children: ReactNode }) {
  // A way out on EVERY Back Room page, not just the hub. The installed PWA has
  // no browser chrome, so without this a member who lands straight in a room
  // (push notification deep link) has no path back to their agent dashboard.
  const me = await primarySessionMember();
  const dashboardHref = me && me.platform === 'via'
    ? (me.type === 'buyer' ? `/buyer/${encodeURIComponent(me.ref)}/admin` : `/seller/${encodeURIComponent(me.ref)}/admin`)
    : null;

  return (
    <div
      data-skin="backroom"
      className={`${newsreader.variable} ${sourceSans.variable}`}
      style={{ minHeight: '100vh' }}
    >
      <header
        className="br-sans"
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          maxWidth: 640, margin: '0 auto', padding: '14px 20px 0',
        }}
      >
        <Link href="/backroom" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none' }}>
          The Back Room
        </Link>
        {dashboardHref && (
          <Link href={dashboardHref} style={{ fontSize: 13, color: 'var(--ink-2)', textDecoration: 'none', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '6px 14px' }}>
            Your dashboard &rarr;
          </Link>
        )}
      </header>
      {children}
      <InstallPrompt />
    </div>
  );
}
