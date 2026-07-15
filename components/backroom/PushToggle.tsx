'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Per-device push opt-in for the Back Room, shown in the hub's Notifications
 * card next to the email-digest toggle. Enabling subscribes THIS browser (the
 * installed PWA) via the Push API and stores the subscription against the
 * member; disabling removes it.
 *
 * iOS only delivers web push to an INSTALLED PWA (16.4+), so on iOS Safari in a
 * normal tab we show an install-first hint instead of a dead toggle. Browsers
 * with no Push API render nothing.
 */

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua);
  const safari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return ios && safari;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const hint: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, margin: '10px 0 0' };

export function PushToggle({ handle }: { handle: string }) {
  const [supported, setSupported] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [iosTab, setIosTab] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const sup = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(sup);
    setStandalone(isStandalone());
    setIosTab(isIosSafari() && !isStandalone());
    if (Notification?.permission === 'denied') setDenied(true);
    if (!sup) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setOn(!!sub))
      .catch(() => {});
  }, []);

  const vapidKey = useCallback(async (): Promise<string> => {
    const inlined = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (inlined) return inlined;
    const res = await fetch('/api/backroom/push/subscribe');
    const j = await res.json().catch(() => ({}));
    return (j as { vapidPublicKey?: string }).vapidPublicKey ?? '';
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setDenied(perm === 'denied'); setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const key = await vapidKey();
      if (!key) { setBusy(false); return; }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await fetch('/api/backroom/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: handle, subscription: sub.toJSON() }),
      });
      setOn(true);
    } catch { /* leave off */ }
    setBusy(false);
  }, [handle, vapidKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch('/api/backroom/push/unsubscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: handle, endpoint }),
        });
      }
      setOn(false);
    } catch { /* leave on */ }
    setBusy(false);
  }, [handle]);

  if (!supported) return null;

  if (iosTab) {
    return (
      <p className="br-sans" style={hint}>
        To get push alerts on iPhone, install The Back Room first: tap Share, then Add to Home Screen, and enable notifications from the installed app.
      </p>
    );
  }

  return (
    <>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 10, cursor: busy ? 'default' : 'pointer' }}>
        <input type="checkbox" checked={on} disabled={busy || denied} onChange={() => (on ? disable() : enable())} style={{ marginTop: 3 }} />
        <span className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Push new activity to this device. A quiet alert when someone adds to a room you are in.
        </span>
      </label>
      {denied && (
        <p className="br-sans" style={hint}>Notifications are blocked for this site. Turn them on in your browser settings to enable push.</p>
      )}
    </>
  );
}
