'use client';

/**
 * The Back Room hub: the plain-language entry point. Explains what the room is,
 * links a signed-in member to their taste, their Door and their rooms, and lets
 * anyone try the voice on the spot. Member-facing copy: the actor is VIA.
 */
import { useState } from 'react';
import Link from 'next/link';
import { HoldToSpeak } from './HoldToSpeak';

interface HubRoom { id: string; name: string; accent_hex: string }

interface VoiceResult {
  transcript: string;
  action: { tool: string | null; say: string } | null;
  total_ms?: number;
  error?: string;
  note?: string;
}

export function BackroomHub({ handle, memberType, label, rooms }: { handle: string | null; memberType: string | null; label: string | null; rooms: HubRoom[] }) {
  const isBuyer = memberType === 'buyer';
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  async function startRoom() {
    if (!handle || !newName.trim()) return;
    setCreating(true); setCreateErr(null);
    const res = await fetch('/api/backroom/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: handle, name: newName.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.room?.id) {
      window.location.href = `/room/${json.room.id}?handle=${encodeURIComponent(handle)}`;
    } else {
      setCreateErr(json.message || json.error || 'could not start the room');
      setCreating(false);
    }
  }

  async function onUtterance(blob: Blob) {
    setBusy(true); setResult(null);
    const form = new FormData();
    form.append('audio', blob, 'utterance');
    if (handle) form.append('member', handle);
    const res = await fetch('/api/backroom/voice', { method: 'POST', body: form });
    setResult((await res.json()) as VoiceResult);
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '56px 20px 180px' }}>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>The Back Room</p>
      <h1 className="br-serif" style={{ fontSize: 36, fontWeight: 400, margin: '8px 0 16px', lineHeight: 1.1 }}>
        A room of people who should know each other
      </h1>
      <p className="br-sans" style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
        Private, small, and quiet. You are matched on how you see, not what you already make, and
        introduced properly. Inside, a shared table holds the work: references, links, voice notes,
        the things you are making together. You speak, and VIA handles the errands and the money in
        the background. Nothing here is watched.
      </p>

      {!handle && (
        <div style={{ marginTop: 32, borderTop: '1px solid var(--line)', paddingTop: 24 }}>
          <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 12 }}>
            Open the Back Room from your agent. If you are already signed in to your buying agent or your seller store, you are in. Otherwise sign in there first.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/buyer/login" className="br-sans"
              style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, textDecoration: 'none' }}>
              Buying agent sign in
            </Link>
            <Link href="/seller/login" className="br-sans"
              style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)', fontSize: 14, textDecoration: 'none' }}>
              Seller sign in
            </Link>
          </div>
        </div>
      )}

      {handle && (
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {label && (
            <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>Signed in as {label}.</p>
          )}
          {isBuyer && <HubLink href={`/you?handle=${encodeURIComponent(handle)}`} title="Your taste" desc="The references and obsessions VIA matches you on. Yours to write and change." />}
          {isBuyer && <HubLink href={`/door?handle=${encodeURIComponent(handle)}`} title="The Door" desc="Where introductions arrive. Accept, decline, or leave them." />}
          {rooms.length === 0 ? (
            <div style={cardStyle}>
              <p className="br-serif" style={{ fontSize: 18, margin: 0 }}>Your rooms</p>
              <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', margin: '4px 0 0' }}>None yet. A room forms once an introduction connects.</p>
            </div>
          ) : (
            rooms.map((r) => (
              <HubLink key={r.id} href={`/room/${r.id}?handle=${encodeURIComponent(handle)}`} title={r.name} desc="Open the room and its table." accent={r.accent_hex} />
            ))
          )}

          {/* Start a room: any member can, and becomes its founder. */}
          <div style={cardStyle}>
            <p className="br-serif" style={{ fontSize: 18, margin: 0 }}>Start a room</p>
            <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', margin: '4px 0 10px' }}>Form a new room and become its founder. You choose who to bring in.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="br-sans"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name your room"
                style={{ flex: 1, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }}
              />
              <button type="button" onClick={startRoom} disabled={creating || !newName.trim()} className="br-sans"
                style={{ padding: '10px 20px', borderRadius: 4, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer', opacity: creating || !newName.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                {creating ? 'Forming…' : 'Form room'}
              </button>
            </div>
            {createErr && <p className="br-sans" style={{ fontSize: 13, color: 'var(--danger)', margin: '8px 0 0' }}>{createErr}</p>}
          </div>
        </div>
      )}

      {/* Try the voice */}
      <div style={{ marginTop: 40, borderTop: '1px solid var(--line)', paddingTop: 24 }}>
        <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>Try speaking</p>
        <p className="br-serif" style={{ fontSize: 22, margin: '6px 0 4px' }}>Hold the button and say something</p>
        <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-2)', margin: 0, lineHeight: 1.6 }}>
          For example: put this link on the table, example dot com. Or: find a pressing plant that
          does 180 gram. VIA turns your words into an action.
        </p>
        {busy && <p className="br-sans" style={{ marginTop: 16, color: 'var(--ink-3)' }}>One moment…</p>}
        {result && !result.error && (
          <div style={{ marginTop: 16 }}>
            <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>Heard</p>
            <p className="br-serif" style={{ fontSize: 19, margin: '2px 0 10px', color: 'var(--ink)' }}>{result.transcript || result.note || '(nothing)'}</p>
            {result.action?.say && <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-2)', fontStyle: 'italic' }}>VIA: {result.action.say}</p>}
          </div>
        )}
        {result?.error && <p className="br-sans" style={{ marginTop: 12, color: 'var(--danger)' }}>{result.error}</p>}
      </div>

      <HoldToSpeak onUtterance={onUtterance} />
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'block', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 18px',
  background: 'var(--paper)', textDecoration: 'none',
};

function HubLink({ href, title, desc, accent }: { href: string; title: string; desc: string; accent?: string }) {
  return (
    <Link href={href} style={cardStyle}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {accent && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: accent }} />}
        <span className="br-serif" style={{ fontSize: 18, color: 'var(--ink)' }}>{title}</span>
      </span>
      <span className="br-sans" style={{ display: 'block', fontSize: 14, color: 'var(--ink-3)', marginTop: 4 }}>{desc}</span>
    </Link>
  );
}
