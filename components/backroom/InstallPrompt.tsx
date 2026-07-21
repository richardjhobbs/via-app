'use client';

import { useEffect, useState } from 'react';

// Deliberate install signal for the Back Room PWA. Rendered inside the
// data-skin="backroom" wrapper, so the --bg / --ink tokens resolve to the paper
// palette. Two paths, because the platforms differ:
//  - Android / Chrome / Edge fire `beforeinstallprompt`. We capture and defer
//    it, then surface our own "Install" button that calls prompt() on click.
//  - iOS Safari fires nothing. We detect iOS + non-standalone and show the
//    manual Share -> "Add to Home Screen" instruction instead.
//
// The banner never shows when already installed (standalone), and a dismissal
// is remembered for 30 days so we don't nag.

const DEFAULT_DISMISS_KEY = 'backroom-install-dismissed';
const DISMISS_DAYS = 30;
const IOS_DELAY_MS = 4000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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

function recentlyDismissed(dismissKey: string): boolean {
  try {
    const raw = localStorage.getItem(dismissKey);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InstallPrompt({
  appName = 'The Back Room',
  dismissKey = DEFAULT_DISMISS_KEY,
  fontClass = 'br-sans',
}: { appName?: string; dismissKey?: string; fontClass?: string } = {}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (recentlyDismissed(dismissKey)) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      try { localStorage.setItem(dismissKey, String(Date.now())); } catch {}
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) {
      iosTimer = setTimeout(() => { setIosHint(true); setVisible(true); }, IOS_DELAY_MS);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, [dismissKey]);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(dismissKey, String(Date.now())); } catch {}
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={`Install ${appName}`}
      className={fontClass}
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60,
        margin: '0 auto', maxWidth: 420,
        background: 'var(--bg)', color: 'var(--ink)',
        border: '1px solid var(--line-strong)', borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Install</div>
          <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ink-2)' }}>
            {iosHint ? (
              <>Add {appName} to your home screen: tap the Share icon, then <strong style={{ color: 'var(--ink)' }}>Add to Home Screen</strong>.</>
            ) : (
              <>Add {appName} to your home screen for instant access and notifications.</>
            )}
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss"
          style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2 }}>
          &times;
        </button>
      </div>

      {!iosHint && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={install}
            style={{ flex: 1, justifyContent: 'center', padding: '10px 20px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer' }}>
            Install
          </button>
          <button onClick={dismiss}
            style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 13, letterSpacing: '0.04em', padding: '0 4px' }}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
