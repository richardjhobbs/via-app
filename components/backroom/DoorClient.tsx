'use client';

/**
 * The Door. Knocks arrive here with their context pack. Accept (a deliberate
 * tap), decline (silent), or leave it. Calm, not promotional; empty most of the
 * time, which is correct.
 */
import { useCallback, useEffect, useState } from 'react';

interface Party { member_type: string; member_ref: string; }
interface ContextPack {
  why?: string;
  shared_references?: string[];
  they_make?: string;
  opening_thread?: string;
}
interface Knock { id: string; other: Party; context_pack: ContextPack; status: string; other_card_slug?: string | null; }

export function DoorClient({ handle }: { handle: string }) {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteCardSlug, setNoteCardSlug] = useState<string | null>(null);
  const [noteRoomId, setNoteRoomId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) { setLoaded(true); return; }
    (async () => {
      const res = await fetch(`/api/backroom/door?handle=${encodeURIComponent(handle)}`);
      if (res.ok) {
        const json = await res.json() as { knocks: Knock[] };
        setKnocks(json.knocks);
      }
      setLoaded(true);
    })();
  }, [handle]);

  const respond = useCallback(async (introId: string, accept: boolean) => {
    setBusyId(introId);
    const res = await fetch('/api/backroom/door', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, intro_id: introId, accept }),
    });
    if (res.ok) {
      const json = await res.json() as { outcome: string; room_id?: string | null };
      const answered = knocks.find((k) => k.id === introId);
      setKnocks((ks) => ks.filter((k) => k.id !== introId));
      // Only an accept is acknowledged; a decline leaves nothing behind.
      if (accept) {
        const connected = json.outcome === 'connected';
        setNote(connected ? 'Connected. Your room is ready.' : 'Accepted. If they accept too, you connect and a room forms.');
        setNoteCardSlug(connected ? answered?.other_card_slug ?? null : null);
        setNoteRoomId(connected ? json.room_id ?? null : null);
      } else {
        setNote(null);
        setNoteCardSlug(null);
        setNoteRoomId(null);
      }
    }
    setBusyId(null);
  }, [handle, knocks]);

  if (!handle) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 20px' }}>
        <p className="br-sans" style={{ color: 'var(--ink-2)' }}>Open this with your member handle, for example /door?handle=yourname.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px 120px' }}>
      <a href="/backroom" className="br-sans" style={{ display: 'inline-block', marginBottom: 20, fontSize: 13, color: 'var(--ink-3)', textDecoration: 'none' }}>
        &larr; The Back Room
      </a>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>The Door</p>

      {note && (
        <div style={{ marginTop: 20 }}>
          <p className="br-serif" style={{ fontSize: 20, color: 'var(--ink)', margin: 0 }}>{note}</p>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center' }}>
            {noteRoomId && (
              <a href={`/room/${noteRoomId}?handle=${encodeURIComponent(handle)}`} className="br-sans"
                style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, textDecoration: 'none' }}>
                Open your room
              </a>
            )}
            {noteCardSlug && (
              <a href={`/taste/${noteCardSlug}`} className="br-sans" style={{ fontSize: 14, color: 'var(--accent)' }}>Their card</a>
            )}
          </div>
        </div>
      )}

      {loaded && knocks.length === 0 && !note && (
        <p className="br-serif" style={{ fontSize: 24, color: 'var(--ink-2)', marginTop: 40, lineHeight: 1.4 }}>
          No one at the door.
        </p>
      )}

      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {knocks.map((k) => (
          <article key={k.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>A knock</p>
            <h2 className="br-serif" style={{ fontSize: 26, fontWeight: 400, margin: '6px 0 12px' }}>{k.other.member_ref}</h2>

            {k.context_pack.why && <Line label="Why" value={k.context_pack.why} />}
            {Array.isArray(k.context_pack.shared_references) && k.context_pack.shared_references.length > 0 && (
              <Line label="You share" value={k.context_pack.shared_references.join(', ')} />
            )}
            {k.context_pack.they_make && <Line label="They make" value={k.context_pack.they_make} />}
            {k.context_pack.opening_thread && <Line label="A way in" value={k.context_pack.opening_thread} />}
            {k.other_card_slug && (
              <p className="br-sans" style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.5 }}>
                <a href={`/taste/${k.other_card_slug}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  See their taste card, in their own words
                </a>
              </p>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
              <button
                type="button"
                disabled={busyId === k.id}
                onClick={() => respond(k.id, true)}
                className="br-sans"
                style={{ padding: '12px 26px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer' }}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busyId === k.id}
                onClick={() => respond(k.id, false)}
                className="br-sans"
                style={{ padding: '12px 26px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-2)', fontSize: 14, cursor: 'pointer' }}
              >
                Decline
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="br-sans" style={{ margin: '0 0 8px', fontSize: 15, color: 'var(--ink)', lineHeight: 1.5 }}>
      <span style={{ color: 'var(--ink-3)' }}>{label}: </span>{value}
    </p>
  );
}
