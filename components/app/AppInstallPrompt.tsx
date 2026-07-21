'use client';

import { usePathname } from 'next/navigation';
import { InstallPrompt } from '@/components/backroom/InstallPrompt';

// The Back Room route group carries its own manifest and its own install
// prompt ("The Back Room" app); the VIA prompt must not stack on top of it.
const BACKROOM_PREFIXES = ['/backroom', '/room/', '/door', '/you'];

/** The app-wide "install VIA" banner, everywhere except the Back Room skin. */
export function AppInstallPrompt() {
  const pathname = usePathname() ?? '';
  const inBackroom = BACKROOM_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
  if (inBackroom) return null;
  return <InstallPrompt appName="VIA" dismissKey="via-install-dismissed" fontClass="" />;
}
