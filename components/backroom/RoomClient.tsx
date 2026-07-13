'use client';

/**
 * The Room. The table is the primary surface: objects placed and arranged,
 * voice notes as waveforms, presence as warmth (recent activity reads warmer,
 * no dots or counts). Hold to speak sits persistently at the bottom centre.
 * One room, full screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoldToSpeak } from './HoldToSpeak';

interface TableObject {
  id: string;
  object_type: string;
  content: string;
  corner: string | null;
  author_ref: string;
  created_at: string;
}
interface Warmth { last_event_at: string | null; events_24h: number; }
interface RoomMeta { id: string; name: string; accent_hex: string; member_cap: number; }
interface Quote { title: string; seller: string | null; price_usdc: number | null; page_url: string | null; }
interface Member { member_platform: string; member_type: string; member_ref: string; is_founder: boolean; status: string; }

// Deterministic pseudo-waveform peaks from a string, so a voice note always
// draws the same bars without storing them for the placeholder rendering.
function peaksFrom(seed: string): number[] {
  const out: number[] = [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  for (let i = 0; i < 28; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; out.push(0.25 + (h % 100) / 133); }
  return out;
}

export function RoomClient({ roomId, handle, isAdmin = false }: { roomId: string; handle: string; isAdmin?: boolean }) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [objects, setObjects] = useState<TableObject[]>([]);
  const [warmth, setWarmth] = useState<Warmth>({ last_event_at: null, events_24h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [orderRef, setOrderRef] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [youAreFounder, setYouAreFounder] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRef, setInviteRef] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteWhy, setInviteWhy] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!handle && !isAdmin) { setLoaded(true); return; }
    const q = handle ? `?handle=${encodeURIComponent(handle)}` : '';
    const res = await fetch(`/api/backroom/room/${roomId}${q}`);
    if (res.ok) {
      const json = await res.json() as { room: RoomMeta; warmth: Warmth; objects: TableObject[] };
      setMeta(json.room); setWarmth(json.warmth); setObjects(json.objects);
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? 'could not open the room');
    }
    // Members: the founder's management panel, or the superadmin oversight view.
    const mq = handle ? `?ref=${encodeURIComponent(handle)}` : '';
    const mres = await fetch(`/api/backroom/room/${roomId}/members${mq}`);
    if (mres.ok) {
      const mjson = await mres.json() as { you_are_founder: boolean; members: Member[] };
      setYouAreFounder(mjson.you_are_founder);
      setMembers(mjson.members);
    }
    setLoaded(true);
  }, [roomId, handle, isAdmin]);

  const moderate = useCallback(async (target: Member, action: 'remove' | 'block' | 'restore') => {
    await fetch(`/api/backroom/room/${roomId}/members`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: handle, action,
        target_platform: target.member_platform, target_type: target.member_type, target_ref: target.member_ref,
      }),
    });
    void load();
  }, [roomId, handle, load]);

  const invite = useCallback(async (mode: 'agent' | 'person') => {
    setInviteBusy(true); setInviteMsg(null); setInviteLink(null);
    const body = mode === 'agent'
      ? { ref: handle, mode, invitee_ref: inviteRef.trim(), why: inviteWhy.trim() }
      : { ref: handle, mode, name: inviteName.trim(), why: inviteWhy.trim() };
    const res = await fetch(`/api/backroom/room/${roomId}/invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      if (json.link) { setInviteLink(json.link); setInviteMsg('Share this link. It joins them when they register.'); }
      else { setInviteMsg(`Invited ${json.invitee_ref}. They will see it in their invitations.`); setInviteRef(''); }
    } else {
      setInviteMsg(json.message || json.error || 'could not send the invitation');
    }
    setInviteBusy(false);
  }, [roomId, handle, inviteRef, inviteName, inviteWhy]);

  useEffect(() => { void load(); }, [load]);

  const onUtterance = useCallback(async (blob: Blob) => {
    setBusy(true); setSaid(null);
    const form = new FormData();
    form.append('handle', handle);
    form.append('audio', blob, 'utterance');
    const res = await fetch(`/api/backroom/room/${roomId}/voice`, { method: 'POST', body: form });
    if (res.ok) {
      const json = await res.json() as { action?: { say?: string }; objects?: TableObject[]; quotes?: Quote[] };
      setSaid(json.action?.say ?? null);
      if (json.objects) setObjects(json.objects);
      if (json.quotes) setQuotes(json.quotes);
      void load();
    }
    setBusy(false);
  }, [roomId, handle, load]);

  // Record a paid order on the table. Paying happens at the existing checkout
  // (the deliberate money press); this brings the settled result back.
  const recordOrder = useCallback(async () => {
    const ref = orderRef.trim();
    if (!ref) return;
    setBusy(true);
    const res = await fetch(`/api/backroom/room/${roomId}/errand`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, action: 'record', order_ref: ref }),
    });
    if (res.ok) {
      const json = await res.json() as { status: string; order_status?: string };
      setSaid(json.status === 'placed' ? 'On the table.' : `That order has not settled yet (${json.order_status ?? 'pending'}).`);
      if (json.status === 'placed') { setOrderRef(''); setQuotes([]); }
      void load();
    }
    setBusy(false);
  }, [roomId, handle, orderRef, load]);

  // Warmth: how recently the room was touched, mapped to a gentle glow. No count
  // is shown; you feel whether the room is alive, you do not read a number.
  const warmthGlow = useMemo(() => {
    if (!warmth.last_event_at) return 0;
    const ageMs = Date.now() - new Date(warmth.last_event_at).getTime();
    const hours = ageMs / 3_600_000;
    return Math.max(0, Math.min(1, 1 - hours / 48)); // full within the hour, cold after ~2 days
  }, [warmth]);

  const accent = meta?.accent_hex ?? '#8a5a3c';

  if (!handle && !isAdmin) {
    return <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 20px' }}>
      <p className="br-sans" style={{ color: 'var(--ink-2)' }}>Open this with your member handle, for example ?handle=yourname.</p>
    </main>;
  }
  if (loaded && error) {
    return <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 20px' }}>
      <p className="br-serif" style={{ fontSize: 22, color: 'var(--ink-2)' }}>{error}</p>
    </main>;
  }

  return (
    <div style={{ ['--accent' as string]: accent, minHeight: '100vh', position: 'relative' }}>
      {/* Warmth: a soft accent light at the top, stronger when the room is alive. */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(120% 60% at 50% -10%, ${accent}${Math.round(warmthGlow * 40).toString(16).padStart(2, '0')}, transparent 70%)`,
        transition: 'background 1.2s ease',
      }} />

      <main style={{ position: 'relative', maxWidth: 760, margin: '0 auto', padding: '44px 18px 180px' }}>
        <header style={{ marginBottom: 24 }}>
          <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>The Room</p>
          <h1 className="br-serif" style={{ fontSize: 32, fontWeight: 400, margin: '6px 0 0' }}>{meta?.name ?? '...'}</h1>
          {isAdmin && (
            <p className="br-sans" style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)' }}>Superadmin view, read only. Members can be moderated below.</p>
          )}
          <span style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            {(youAreFounder || isAdmin) && (
              <button type="button" onClick={() => setShowMembers((v) => !v)} className="br-sans"
                style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                {showMembers ? 'Hide members' : `Members (${members.filter((m) => m.status === 'active').length})`}
              </button>
            )}
            {handle && !isAdmin && (
              <button type="button" onClick={() => setShowInvite((v) => !v)} className="br-sans"
                style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                {showInvite ? 'Hide invite' : 'Invite someone'}
              </button>
            )}
          </span>
        </header>

        {showInvite && handle && !isAdmin && (
          <section style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 16, marginBottom: 24, background: 'var(--paper)' }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 12px' }}>Invite someone</p>
            <input className="br-sans" value={inviteWhy} onChange={(e) => setInviteWhy(e.target.value)} placeholder="Why them? (shared with the invitation)"
              style={inviteInput} />
            <div style={{ marginTop: 10 }}>
              <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 6px' }}>An agent already on VIA, by handle or store slug:</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="br-sans" value={inviteRef} onChange={(e) => setInviteRef(e.target.value)} placeholder="their-handle" style={{ ...inviteInput, marginTop: 0, flex: 1 }} />
                <button type="button" onClick={() => invite('agent')} disabled={inviteBusy || !inviteRef.trim()} className="br-sans" style={inviteBtn}>Invite agent</button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 6px' }}>Or someone not yet on VIA, get a link to share:</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="br-sans" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Their name (optional)" style={{ ...inviteInput, marginTop: 0, flex: 1 }} />
                <button type="button" onClick={() => invite('person')} disabled={inviteBusy} className="br-sans" style={inviteBtn}>Get a link</button>
              </div>
            </div>
            {inviteMsg && <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-2)', margin: '12px 0 0' }}>{inviteMsg}</p>}
            {inviteLink && (
              <p className="br-sans" style={{ fontSize: 13, color: 'var(--accent)', margin: '6px 0 0', wordBreak: 'break-all' }}>{inviteLink}</p>
            )}
          </section>
        )}

        {(youAreFounder || isAdmin) && showMembers && (
          <section style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 16, marginBottom: 24, background: 'var(--paper)' }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 12px' }}>
              {isAdmin && !youAreFounder ? 'Members · superadmin' : 'Members · you found this room'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map((m, i) => {
                const isYou = m.member_platform === 'via' && m.member_ref === handle;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: i ? '1px solid var(--line)' : 'none', paddingTop: i ? 8 : 0 }}>
                    <span className="br-sans" style={{ fontSize: 14, color: m.status === 'active' ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {m.member_platform}/{m.member_type} · {m.member_ref}
                      {m.is_founder && <span style={{ color: 'var(--accent)' }}> · founder</span>}
                      {m.status !== 'active' && <span style={{ fontStyle: 'italic' }}> · {m.status}</span>}
                    </span>
                    {!m.is_founder && !isYou && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        {m.status === 'active' ? (
                          <>
                            <ModBtn onClick={() => moderate(m, 'remove')}>Remove</ModBtn>
                            <ModBtn onClick={() => moderate(m, 'block')} danger>Block</ModBtn>
                          </>
                        ) : (
                          m.status === 'removed' && <ModBtn onClick={() => moderate(m, 'restore')}>Restore</ModBtn>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {said && (
          <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', fontStyle: 'italic', marginBottom: 20 }}>VIA: {said}</p>
        )}

        {/* Errand: quotes VIA sourced, then bring a paid order back to the table.
            Paying happens at the existing checkout, the deliberate money press. */}
        {quotes.length > 0 && (
          <section style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 16, marginBottom: 24, background: 'var(--paper)' }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 12px' }}>VIA found these</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quotes.slice(0, 5).map((q, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, borderTop: i ? '1px solid var(--line)' : 'none', paddingTop: i ? 10 : 0 }}>
                  <div>
                    <p className="br-serif" style={{ fontSize: 17, margin: 0, color: 'var(--ink)' }}>{q.title}</p>
                    <p className="br-sans" style={{ fontSize: 13, margin: '2px 0 0', color: 'var(--ink-3)' }}>{q.seller ?? 'VIA'}{q.price_usdc != null ? ` · ${q.price_usdc} USDC` : ''}</p>
                  </div>
                  {q.page_url && (
                    <a href={q.page_url} target="_blank" rel="noreferrer" className="br-sans" style={{ fontSize: 13, color: 'var(--accent)', whiteSpace: 'nowrap' }}>Pay for the room ↗</a>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <input
                className="br-sans"
                value={orderRef}
                onChange={(e) => setOrderRef(e.target.value)}
                placeholder="Order reference, once paid"
                style={{ flex: 1, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit' }}
              />
              <button type="button" onClick={recordOrder} disabled={busy || !orderRef.trim()} className="br-sans"
                style={{ padding: '10px 18px', borderRadius: 4, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer', opacity: busy || !orderRef.trim() ? 0.5 : 1 }}>
                Bring to the table
              </button>
            </div>
          </section>
        )}

        {loaded && objects.length === 0 && quotes.length === 0 && (
          <p className="br-serif" style={{ fontSize: 22, color: 'var(--ink-2)', marginTop: 32 }}>The table is empty. Put something on it.</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {objects.map((o) => <ObjectCard key={o.id} o={o} />)}
        </div>
      </main>

      {busy && (
        <p className="br-sans" style={{ position: 'fixed', bottom: 92, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', pointerEvents: 'none' }}>One moment...</p>
      )}
      {handle && <HoldToSpeak onUtterance={onUtterance} />}
    </div>
  );
}

const inviteInput: React.CSSProperties = {
  width: '100%', marginTop: 0, background: 'var(--bg)', color: 'var(--ink)',
  border: '1px solid var(--line-strong)', borderRadius: 4, padding: '9px 11px', fontSize: 14, fontFamily: 'inherit',
};
const inviteBtn: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 4, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)',
  fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
};

function ModBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="br-sans"
      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: danger ? 'var(--danger)' : 'var(--ink-2)', border: `1px solid ${danger ? 'var(--danger)' : 'var(--line-strong)'}` }}>
      {children}
    </button>
  );
}

function ObjectCard({ o }: { o: TableObject }) {
  const base: React.CSSProperties = {
    background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 4,
    padding: '16px', boxShadow: '0 1px 0 var(--line)',
  };
  return (
    <article style={base}>
      <p className="br-sans" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>
        {o.object_type.replace('_', ' ')}
      </p>
      {o.object_type === 'voice_note' ? (
        <Waveform seed={o.id} />
      ) : o.object_type === 'link' ? (
        <a href={o.content.startsWith('http') ? o.content : `https://${o.content}`} target="_blank" rel="noreferrer"
           className="br-sans" style={{ color: 'var(--accent)', fontSize: 15, wordBreak: 'break-word' }}>
          {o.content}
        </a>
      ) : (
        <p className="br-serif" style={{ fontSize: 17, color: 'var(--ink)', margin: 0, lineHeight: 1.4, wordBreak: 'break-word' }}>{o.content}</p>
      )}
      <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '12px 0 0' }}>{o.author_ref}</p>
    </article>
  );
}

function Waveform({ seed }: { seed: string }) {
  const peaks = peaksFrom(seed);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 40 }}>
      {peaks.map((p, i) => (
        <span key={i} style={{ display: 'block', width: 3, height: `${Math.round(p * 100)}%`, background: 'var(--accent)', opacity: 0.7, borderRadius: 2 }} />
      ))}
    </div>
  );
}
