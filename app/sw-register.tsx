'use client';

import { useEffect } from 'react';

// Temporarily disabled while we diagnose a mobile image regression that
// surfaced alongside the first SW deploy. This component now actively
// unregisters any SW that previously installed itself on a user's device.
// The matching /sw.js kill switch also self-unregisters when the browser
// fetches it during its periodic SW update check.
export function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
  }, []);

  return null;
}
