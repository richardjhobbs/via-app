'use client';

/**
 * Explicit share targets for a taste card. Deliberately NOT navigator.share:
 * on desktop that opens the OS share sheet (Nearby Sharing, Teams, Copilot...),
 * which is not what anyone wants. These are plain web-intent links that behave
 * the same on desktop and mobile (wa.me and t.me open the app when installed),
 * plus copy link.
 */
import { useState } from 'react';

export function ShareButtons({ cardUrl, accent }: { cardUrl: string; accent: string }) {
  const [note, setNote] = useState('');

  const site = cardUrl.replace(/\/taste\/.*$/, '');
  const makeYours = `${site}/taste`;
  const message = `I made my taste card on VIA: ${cardUrl}\n\nMeet people who think like you and make your own: ${makeYours}`;
  const enc = encodeURIComponent(message);

  const targets: { label: string; href: string; bg: string; fg: string }[] = [
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc}`, bg: '#25D366', fg: '#ffffff' },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encodeURIComponent(cardUrl)}&text=${encodeURIComponent(`Meet people who think like you. Make your own: ${makeYours}`)}`, bg: '#229ED9', fg: '#ffffff' },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${enc}`, bg: '#0f0f0f', fg: '#ffffff' },
    { label: 'Email', href: `mailto:?subject=${encodeURIComponent('My taste card on VIA')}&body=${enc}`, bg: 'transparent', fg: 'var(--ink)' },
  ];

  async function copyLink() {
    try { await navigator.clipboard.writeText(cardUrl); setNote('Link copied.'); }
    catch { setNote(cardUrl); }
  }
  async function copyMessage() {
    try { await navigator.clipboard.writeText(message); setNote('Invite copied. Paste it anywhere.'); }
    catch { setNote(message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {targets.map((t) => (
          <a
            key={t.label}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className="br-sans"
            style={{
              padding: '9px 18px', borderRadius: 999, fontSize: 14, textDecoration: 'none',
              background: t.bg,
              color: t.fg,
              border: t.bg === 'transparent' ? '1px solid var(--ink)' : '1px solid transparent',
            }}
          >
            {t.label}
          </a>
        ))}
        <button type="button" onClick={() => void copyLink()} className="br-sans"
          style={{ padding: '9px 18px', borderRadius: 999, fontSize: 14, cursor: 'pointer', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)' }}>
          Copy link
        </button>
        <button type="button" onClick={() => void copyMessage()} className="br-sans"
          style={{ padding: '9px 18px', borderRadius: 999, fontSize: 14, cursor: 'pointer', background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--line-strong)' }}>
          Copy invite
        </button>
      </div>
      {note && <p className="br-sans" style={{ fontSize: 13, color: 'var(--live)', margin: '10px 0 0' }}>{note}</p>}
    </div>
  );
}
