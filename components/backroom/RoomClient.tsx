'use client';

/**
 * The Room. The table is the primary surface: objects placed and arranged,
 * voice notes as waveforms, presence as warmth (recent activity reads warmer,
 * no dots or counts). Hold to speak sits persistently at the bottom centre.
 * One room, full screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HoldToSpeak } from './HoldToSpeak';

interface TableObject {
  id: string;
  object_type: string;
  content: string;
  corner: string | null;
  author_ref: string;
  created_at: string;
  url?: string | null;
  mime?: string | null;
  filename?: string | null;
  size?: number | null;
}

// Files a member may attach. Mirrors the server allowlist (lib/app/backroom/
// room-files.ts): images and documents, no executables. Used for the picker's
// accept hint; the server is the real gate.
const FILE_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.rtf,.odt,.ods,.odp';
interface Warmth { last_event_at: string | null; events_24h: number; }
interface RoomMeta { id: string; name: string; accent_hex: string; member_cap: number; }
interface Quote { title: string; seller: string | null; price_usdc: number | null; page_url: string | null; }
interface Member { member_platform: string; member_type: string; member_ref: string; is_founder: boolean; status: string; card_slug?: string | null; }
interface SentInvite { id: string; kind: string; status: string; why: string; invitee: string; link: string | null; email: string | null; created_at: string; }
interface ChatMessage { id: string; author_platform: string; author_ref: string; text: string; created_at: string; }

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
  const [modalObject, setModalObject] = useState<TableObject | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [mentionMatches, setMentionMatches] = useState<string[]>([]);
  const [voiceTarget, setVoiceTarget] = useState<'chat' | 'table' | 'voice'>('chat');
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteWhy, setInviteWhy] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);
  const [note, setNote] = useState('');
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // One call returns the table, warmth, members, founder flag, and chat.
  const load = useCallback(async () => {
    if (!handle && !isAdmin) { setLoaded(true); return; }
    const q = handle ? `?handle=${encodeURIComponent(handle)}` : '';
    const res = await fetch(`/api/backroom/room/${roomId}${q}`);
    if (res.ok) {
      const json = await res.json() as { room: RoomMeta; warmth: Warmth; objects: TableObject[]; members: Member[]; you_are_founder: boolean; chat: ChatMessage[] };
      setMeta(json.room); setWarmth(json.warmth); setObjects(json.objects);
      setMembers(json.members ?? []); setYouAreFounder(!!json.you_are_founder);
      if (Array.isArray(json.chat)) setChat(json.chat);
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? 'could not open the room');
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

  const loadSentInvites = useCallback(async () => {
    if (!handle) return;
    const res = await fetch(`/api/backroom/room/${roomId}/invite?ref=${encodeURIComponent(handle)}`);
    if (res.ok) { const j = await res.json() as { sent: SentInvite[] }; setSentInvites(j.sent ?? []); }
  }, [roomId, handle]);

  const invite = useCallback(async (mode: 'agent' | 'person') => {
    setInviteBusy(true); setInviteMsg(null); setInviteLink(null);
    const body = mode === 'agent'
      ? { ref: handle, mode, invitee_ref: inviteRef.trim(), why: inviteWhy.trim() }
      : { ref: handle, mode, name: inviteName.trim(), email: inviteEmail.trim(), why: inviteWhy.trim() };
    const res = await fetch(`/api/backroom/room/${roomId}/invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      if (json.link) {
        setInviteLink(json.link);
        setInviteMsg(json.emailed ? `Emailed the link to ${inviteEmail.trim()}. You can also share it below.` : 'Share this link. It joins them when they register.');
        setInviteName(''); setInviteEmail('');
      } else if (json.status === 'seated') {
        setInviteMsg(`Added ${json.name || json.invitee_ref} to the room${json.emailed ? ', and emailed their owner.' : '.'}`);
        setInviteRef('');
        void load();
      } else {
        setInviteMsg(json.emailed
          ? `Invited ${json.invitee_ref}. Their owner has been emailed, and it is in their invitations.`
          : `Invited ${json.invitee_ref}. They will see it in their invitations.`);
        setInviteRef('');
      }
      void loadSentInvites();
    } else {
      setInviteMsg(json.message || json.error || 'could not send the invitation');
    }
    setInviteBusy(false);
  }, [roomId, handle, inviteRef, inviteName, inviteEmail, inviteWhy, loadSentInvites, load]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (showInvite) void loadSentInvites(); }, [showInvite, loadSentInvites]);

  // Group chat. The room's ambient talk stream, newest first (top of the box).
  const loadChat = useCallback(async () => {
    if (!handle) return;
    const res = await fetch(`/api/backroom/room/${roomId}/chat?handle=${encodeURIComponent(handle)}`);
    if (res.ok) { const j = await res.json() as { messages: ChatMessage[] }; setChat(j.messages); }
  }, [roomId, handle]);

  const onUtterance = useCallback(async (blob: Blob) => {
    setBusy(true); setSaid(null);
    // A voice note is stored and played back, so transcode to MP3 for
    // cross-browser playback. Transcription targets send the raw recording.
    let sendBlob = blob;
    let filename = 'utterance';
    if (voiceTarget === 'voice') {
      try { const { toMp3 } = await import('./toMp3'); sendBlob = await toMp3(blob); filename = 'voice-note.mp3'; }
      catch (e) { console.warn('[room] mp3 transcode failed, storing original:', e); }
    }
    const form = new FormData();
    form.append('handle', handle);
    form.append('target', voiceTarget);
    form.append('audio', sendBlob, filename);
    const res = await fetch(`/api/backroom/room/${roomId}/voice`, { method: 'POST', body: form });
    if (res.ok) {
      const json = await res.json() as { action?: { say?: string }; objects?: TableObject[]; quotes?: Quote[] };
      setSaid(json.action?.say ?? null);
      if (json.objects) setObjects(json.objects);
      if (json.quotes) setQuotes(json.quotes);
      void load();
      void loadChat();
    }
    setBusy(false);
  }, [roomId, handle, voiceTarget, load, loadChat]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !handle) return;
    setChatBusy(true);
    const res = await fetch(`/api/backroom/room/${roomId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, text }),
    });
    if (res.ok) { const j = await res.json() as { messages: ChatMessage[] }; setChat(j.messages); setChatInput(''); setMentionMatches([]); }
    setChatBusy(false);
  }, [roomId, handle, chatInput]);

  // @mention: match the trailing "@word" against active members (not yourself).
  const onChatChange = useCallback((v: string) => {
    setChatInput(v);
    const m = v.match(/@([\w-]*)$/);
    if (m) {
      const q = m[1].toLowerCase();
      setMentionMatches(
        members
          .filter((mm) => mm.status === 'active' && mm.member_ref !== handle && mm.member_ref.toLowerCase().includes(q))
          .map((mm) => mm.member_ref)
          .slice(0, 6),
      );
    } else { setMentionMatches([]); }
  }, [members, handle]);

  const pickMention = useCallback((ref: string) => {
    setChatInput((v) => v.replace(/@([\w-]*)$/, `@${ref} `));
    setMentionMatches([]);
  }, []);

  const memberRefs = useMemo(() => new Set(members.map((m) => m.member_ref)), [members]);

  // The initial chat arrives with load(); keep it current with a light poll,
  // paused while the tab is hidden so it does not run in the background.
  useEffect(() => {
    if (!handle) return;
    const t = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void loadChat(); }, 7000);
    return () => clearInterval(t);
  }, [handle, loadChat]);

  // Text input. Voice is promoted, but anyone can type onto the table instead.
  const placeNote = useCallback(async () => {
    const text = note.trim();
    if (!text) return;
    setComposerBusy(true); setComposerErr(null);
    const res = await fetch(`/api/backroom/room/${roomId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, text }),
    });
    if (res.ok) { const j = await res.json() as { objects?: TableObject[] }; if (j.objects) setObjects(j.objects); setNote(''); }
    else { const j = await res.json().catch(() => ({})); setComposerErr((j as { error?: string }).error ?? 'could not place that'); }
    setComposerBusy(false);
  }, [roomId, handle, note]);

  // File attachment. The server enforces the allowlist and size cap; here we
  // only pass the file through and surface any rejection.
  const attachFile = useCallback(async (file: File) => {
    setComposerBusy(true); setComposerErr(null);
    const fd = new FormData();
    fd.append('handle', handle);
    fd.append('file', file);
    const res = await fetch(`/api/backroom/room/${roomId}/file`, { method: 'POST', body: fd });
    if (res.ok) { const j = await res.json() as { objects?: TableObject[] }; if (j.objects) setObjects(j.objects); }
    else { const j = await res.json().catch(() => ({})); setComposerErr((j as { error?: string }).error ?? 'could not attach that'); }
    setComposerBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [roomId, handle]);

  // Founder / superadmin: delete a post from the table (and its stored file).
  const deleteObject = useCallback(async (o: TableObject) => {
    if (!confirm('Delete this from the table? This cannot be undone.')) return;
    const q = handle ? `?ref=${encodeURIComponent(handle)}` : '';
    const res = await fetch(`/api/backroom/room/${roomId}/object/${o.id}${q}`, { method: 'DELETE' });
    if (res.ok) {
      setObjects((xs) => xs.filter((x) => x.id !== o.id));
      setModalObject((cur) => (cur?.id === o.id ? null : cur));
    } else {
      const j = await res.json().catch(() => ({}));
      alert((j as { error?: string }).error ?? 'could not delete that');
    }
  }, [roomId, handle]);

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
        <a
          href={handle ? '/backroom' : '/admin/backroom'}
          className="br-sans"
          style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          &larr; {handle ? 'The Back Room' : 'Operator console'}
        </a>
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
              <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 6px' }}>A VIA agent by handle or store slug, or an RRG agent by its ID, wallet, or name:</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="br-sans" value={inviteRef} onChange={(e) => setInviteRef(e.target.value)} placeholder="their-handle" style={{ ...inviteInput, marginTop: 0, flex: 1 }} />
                <button type="button" onClick={() => invite('agent')} disabled={inviteBusy || !inviteRef.trim()} className="br-sans" style={inviteBtn}>Invite agent</button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 6px' }}>Or someone not yet on VIA. Add their email to send it for them, or leave it blank to copy a link:</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="br-sans" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Their name (optional)" style={{ ...inviteInput, marginTop: 0, flex: '1 1 140px' }} />
                <input className="br-sans" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Their email (optional)" style={{ ...inviteInput, marginTop: 0, flex: '1 1 180px' }} />
                <button type="button" onClick={() => invite('person')} disabled={inviteBusy} className="br-sans" style={inviteBtn}>{inviteEmail.trim() ? 'Send invite' : 'Get a link'}</button>
              </div>
            </div>
            {inviteMsg && <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-2)', margin: '12px 0 0' }}>{inviteMsg}</p>}
            {inviteLink && (
              <p className="br-sans" style={{ fontSize: 13, color: 'var(--accent)', margin: '6px 0 0', wordBreak: 'break-all' }}>{inviteLink}</p>
            )}

            {sentInvites.length > 0 && (
              <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 10px' }}>Invites you have sent</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sentInvites.map((s) => (
                    <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="br-sans" style={{ fontSize: 14, color: 'var(--ink)' }}>
                        {s.invitee}
                        <span style={{ color: 'var(--ink-3)' }}> · {s.kind === 'person' ? 'person' : 'agent'} · {s.status}</span>
                      </span>
                      {s.kind === 'person' && s.status === 'pending' && s.link && (
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span className="br-sans" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all', flex: 1 }}>{s.link}</span>
                          <button type="button" onClick={() => { void navigator.clipboard?.writeText(s.link!); setInviteMsg('Link copied.'); }} className="br-sans"
                            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Copy</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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
                      {m.member_platform}/{m.member_type} · {m.card_slug
                        ? <a href={`/taste/${m.card_slug}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecorationColor: 'var(--accent)' }}>{m.member_ref}</a>
                        : m.member_ref}
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

        {/* Group chat sits above the table inputs. The room's ambient talk, a
            larger box; newest message at the TOP (input is here too), older below. */}
        {handle && (
          <section style={{ border: '1px solid var(--line-strong)', borderRadius: 8, background: 'var(--paper)', marginBottom: 24, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--line)', position: 'relative' }}>
              <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>Chat</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  className="br-sans"
                  value={chatInput}
                  rows={4}
                  onChange={(e) => onChatChange(e.target.value)}
                  onKeyDown={(e) => composerKeyDown(e, chatInput, (v) => { setChatInput(v); setMentionMatches([]); }, () => { void sendChat(); })}
                  placeholder="Message the room. Type @ to mention someone. Enter sends, Ctrl or Cmd + Enter for a new line."
                  style={{ flex: 1, resize: 'vertical', background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit', lineHeight: 1.45 }}
                />
                <button type="button" onClick={sendChat} disabled={chatBusy || !chatInput.trim()} className="br-sans"
                  style={{ padding: '10px 18px', borderRadius: 4, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer', opacity: chatBusy || !chatInput.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>Send</button>
              </div>
              {mentionMatches.length > 0 && (
                <div style={{ position: 'absolute', left: 14, right: 14, top: '100%', zIndex: 5, background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                  {mentionMatches.map((ref) => (
                    <button key={ref} type="button" onClick={() => pickMention(ref)} className="br-sans"
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--ink)', fontSize: 14, cursor: 'pointer' }}>@{ref}</button>
                  ))}
                </div>
              )}
            </div>
            {/* Cap the message area to about 15 lines, then it scrolls. */}
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {chat.length === 0 ? (
                <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', padding: '16px 14px', margin: 0 }}>No messages yet. Say something to the room.</p>
              ) : (
                chat.map((m) => (
                  <div key={m.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
                      <span className="br-sans" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500 }}>{m.author_ref}</span>
                      <span className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{formatStamp(m.created_at)}</span>
                    </div>
                    <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink)', margin: 0, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      <MentionText text={m.text} memberRefs={memberRefs} />
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Table inputs: type a note or attach a file. Hold to speak floats below.
            Images and documents only. Sits under the chat. */}
        {handle && (
          <section style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 24, background: 'var(--paper)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                className="br-sans"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => composerKeyDown(e, note, setNote, () => { void placeNote(); })}
                placeholder="Type a note, or paste a link. Or hold to speak."
                rows={4}
                style={{ flex: 1, resize: 'vertical', minHeight: 84, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit', lineHeight: 1.45 }}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={composerBusy} className="br-sans"
                title="Attach an image or document"
                style={{ padding: '10px 12px', borderRadius: 4, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-2)', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Attach
              </button>
              <button type="button" onClick={placeNote} disabled={composerBusy || !note.trim()} className="br-sans"
                style={{ padding: '10px 18px', borderRadius: 4, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer', opacity: composerBusy || !note.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                Place
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_ACCEPT}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFile(f); }}
              style={{ display: 'none' }}
            />
            <p className="br-sans" style={{ fontSize: 11, color: 'var(--ink-3)', margin: '8px 2px 0' }}>
              Images and documents up to 15 MB. Enter places a note, Ctrl or Cmd + Enter for a new line.
            </p>
            {composerErr && <p className="br-sans" style={{ fontSize: 13, color: 'var(--danger)', margin: '6px 2px 0' }}>{composerErr}</p>}
          </section>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, alignItems: 'start' }}>
          {objects.map((o) => <ObjectCard key={o.id} o={o} onOpen={setModalObject} canModerate={youAreFounder || isAdmin} onDelete={deleteObject} />)}
        </div>

        {/* Make something together: a founder can spin room work into a store.
            Not a priority, so it sits at the bottom, but stays visible. */}
        {youAreFounder && handle && (
          <div style={{ marginTop: 32 }}>
            <MakeTogether roomId={roomId} handle={handle} members={members.filter((m) => m.status === 'active')} accent={meta?.accent_hex ?? 'var(--accent)'} />
          </div>
        )}
      </main>

      {modalObject && (
        <div
          onClick={() => setModalObject(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative', background: 'var(--paper)', border: '1px solid var(--line-strong)', borderRadius: 6,
              maxWidth: modalObject.object_type === 'image' ? '92vw' : 680, maxHeight: '88vh', overflow: 'auto',
              padding: modalObject.object_type === 'image' ? 10 : '28px 30px',
            }}
          >
            <button
              type="button" onClick={() => setModalObject(null)} aria-label="Close"
              style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 24, lineHeight: 1, cursor: 'pointer', zIndex: 1 }}
            >&times;</button>
            {modalObject.object_type === 'image' && modalObject.url ? (
              <img src={modalObject.url} alt={modalObject.filename ?? 'image'} style={{ display: 'block', maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', margin: '0 auto' }} />
            ) : (
              <>
                <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 14px' }}>Note · {modalObject.author_ref} · {formatStamp(modalObject.created_at)}</p>
                <p className="br-serif" style={{ fontSize: 18, color: 'var(--ink)', margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{modalObject.content}</p>
              </>
            )}
          </div>
        </div>
      )}

      {busy && (
        <p className="br-sans" style={{ position: 'fixed', bottom: 92, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', pointerEvents: 'none' }}>One moment...</p>
      )}
      {/* Voice target: hold-to-speak sends your words to the chat or to the
          table (as a note), whichever is selected here. Sits above the button. */}
      {handle && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 96, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
          <div style={{ display: 'inline-flex', pointerEvents: 'auto', border: '1px solid var(--line-strong)', borderRadius: 999, overflow: 'hidden', background: 'var(--bg)' }}>
            {(['chat', 'table', 'voice'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setVoiceTarget(t)} className="br-sans"
                style={{
                  padding: '6px 14px', fontSize: 12, border: 'none', cursor: 'pointer',
                  background: voiceTarget === t ? 'var(--ink)' : 'transparent',
                  color: voiceTarget === t ? 'var(--bg)' : 'var(--ink-2)',
                }}>
                {t === 'chat' ? 'To chat' : t === 'table' ? 'To table' : 'Voice note'}
              </button>
            ))}
          </div>
        </div>
      )}
      {handle && <HoldToSpeak onUtterance={onUtterance} />}
    </div>
  );
}

interface Suggestion { from: string; title: string; pitch: string; format: string; suggested_price_usd: number; }

/**
 * The exit ramp, in the room: a founder asks a matched agent for a digital idea
 * (member-triggered, human-gated), then turns it into a product for sale with an
 * agreed split. Everything runs through the graduate + suggest routes.
 */
function MakeTogether({ roomId, handle, members, accent }: { roomId: string; handle: string; members: Member[]; accent: string }) {
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestBusy, setSuggestBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('4');
  const [pcts, setPcts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);

  const key = (m: Member) => `${m.member_platform}/${m.member_type}/${m.member_ref}`;
  const others = members.filter((m) => !(m.member_platform === 'via' && m.member_ref === handle));

  function ensurePcts(): Record<string, number> {
    if (Object.keys(pcts).length) return pcts;
    const each = Math.floor((100 / members.length) * 100) / 100;
    const seed: Record<string, number> = {};
    members.forEach((m, i) => { seed[key(m)] = i === members.length - 1 ? Math.round((100 - each * (members.length - 1)) * 100) / 100 : each; });
    setPcts(seed);
    return seed;
  }

  async function ask(m: Member) {
    setSuggestBusy(key(m)); setMsg(null);
    const res = await fetch(`/api/backroom/room/${roomId}/suggest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: handle, from_ref: m.member_ref, from_platform: m.member_platform, from_type: m.member_type }),
    });
    const json = await res.json().catch(() => ({})) as { suggestion?: Suggestion; error?: string };
    setSuggestBusy(null);
    if (json.suggestion) { setSuggestion(json.suggestion); }
    else setMsg(json.error || 'Could not get an idea right now.');
  }

  async function addSuggestionToTable() {
    if (!suggestion) return;
    await fetch(`/api/backroom/room/${roomId}/suggest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: handle, action: 'accept', suggestion }),
    });
    setMsg('Added to the table.');
  }

  function useIdea() {
    if (!suggestion) return;
    setTitle(suggestion.title);
    setPrice(String(suggestion.suggested_price_usd));
    ensurePcts();
  }

  async function make() {
    const p = ensurePcts();
    setBusy(true); setMsg(null); setCardUrl(null);
    const cocreators = members.map((m) => ({ platform: m.member_platform, type: m.member_type, ref: m.member_ref, pct: p[key(m)] ?? 0 }));
    const res = await fetch(`/api/backroom/room/${roomId}/graduate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: handle, title: title.trim(), price_usd: Number(price), cocreators }),
    });
    const json = await res.json().catch(() => ({})) as { card_url?: string; error?: string };
    setBusy(false);
    if (json.card_url) { setCardUrl(json.card_url); setMsg('Made. Pending VIA approval before it goes on sale.'); }
    else setMsg(json.error || 'Could not make it.');
  }

  const p = ensurePctsView();
  function ensurePctsView(): Record<string, number> { return Object.keys(pcts).length ? pcts : {}; }

  return (
    <section style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 16, marginBottom: 24, background: 'var(--paper)' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="br-sans"
        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink)', fontSize: 16 }}>
        <span className="br-serif" style={{ fontSize: 18 }}>Make something together</span>
        <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 18 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>Ask for an idea</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {others.map((m) => (
              <button key={key(m)} type="button" onClick={() => void ask(m)} disabled={suggestBusy === key(m)} className="br-sans"
                style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-2)', fontSize: 13, cursor: 'pointer' }}>
                {suggestBusy === key(m) ? 'Thinking...' : `Ask ${m.member_ref}`}
              </button>
            ))}
          </div>

          {suggestion && (
            <div style={{ marginTop: 12, border: `1px solid ${accent}`, borderRadius: 6, padding: '12px 14px', background: 'var(--bg)' }}>
              <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>{suggestion.from} suggested</p>
              <p className="br-serif" style={{ fontSize: 19, margin: '4px 0 2px', color: 'var(--ink)' }}>{suggestion.title}</p>
              <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: '0 0 8px' }}>{suggestion.pitch} ({suggestion.format}, about {suggestion.suggested_price_usd} USDC)</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => void addSuggestionToTable()} className="br-sans" style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-2)', fontSize: 13, cursor: 'pointer' }}>Add to table</button>
                <button type="button" onClick={useIdea} className="br-sans" style={{ padding: '6px 14px', borderRadius: 999, border: `1px solid ${accent}`, background: accent, color: 'var(--bg)', fontSize: 13, cursor: 'pointer' }}>Use this idea</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>Post it for sale (digital)</p>
            <input className="br-sans" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are you selling?" style={{ ...inviteInput, marginBottom: 8 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Price USDC</span>
              <input className="br-sans" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} style={{ ...inviteInput, width: 90 }} />
            </div>
            <p className="br-sans" style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 6px' }}>Split of the seller take (after VIA 2.5%), must total 100%:</p>
            {members.map((m) => (
              <div key={key(m)} className="br-sans" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 14, color: 'var(--ink)' }}>{m.member_ref}</span>
                <input className="br-sans" value={String(p[key(m)] ?? '')} onChange={(e) => setPcts({ ...p, [key(m)]: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
                  style={{ ...inviteInput, width: 70, textAlign: 'right' }} />
              </div>
            ))}
            <button type="button" onClick={() => void make()} disabled={busy || !title.trim()} className="br-sans"
              style={{ marginTop: 8, padding: '10px 22px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, cursor: 'pointer', opacity: busy || !title.trim() ? 0.5 : 1 }}>
              {busy ? 'Making...' : 'Make it'}
            </button>
          </div>

          {msg && <p className="br-sans" style={{ fontSize: 13, color: 'var(--live)', margin: '10px 0 0' }}>{msg}{cardUrl && <> <a href={cardUrl} style={{ color: accent }}>View the store card</a></>}</p>}
        </div>
      )}
    </section>
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

// A short human label for a file object: type and size, e.g. "PDF · 1.2 MB".
function fileMeta(mime?: string | null, size?: number | null): string {
  const type = (() => {
    if (!mime) return 'File';
    if (mime === 'application/pdf') return 'PDF';
    if (mime.includes('word')) return 'Word';
    if (mime.includes('sheet') || mime.includes('excel')) return 'Spreadsheet';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return 'Slides';
    if (mime.startsWith('text/')) return 'Text';
    return mime.split('/').pop()?.toUpperCase() ?? 'File';
  })();
  if (!size || size <= 0) return type;
  const mb = size / (1024 * 1024);
  const sizeStr = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${type} · ${sizeStr}`;
}

function ModBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="br-sans"
      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: danger ? 'var(--danger)' : 'var(--ink-2)', border: `1px solid ${danger ? 'var(--danger)' : 'var(--line-strong)'}` }}>
      {children}
    </button>
  );
}

function ObjectCard({ o, onOpen, canModerate, onDelete }: { o: TableObject; onOpen: (o: TableObject) => void; canModerate?: boolean; onDelete?: (o: TableObject) => void }) {
  const base: React.CSSProperties = {
    position: 'relative',
    background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 4,
    padding: '16px', boxShadow: '0 1px 0 var(--line)',
  };
  const plainBtn: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: 0, margin: 0, border: 'none', background: 'none', font: 'inherit',
  };
  return (
    <article style={base}>
      {canModerate && onDelete && (
        <button
          type="button" onClick={(e) => { e.stopPropagation(); onDelete(o); }}
          title="Delete from the table" aria-label="Delete post"
          style={{ position: 'absolute', top: 6, right: 8, zIndex: 1, background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
        >&times;</button>
      )}
      <p className="br-sans" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>
        {o.object_type.replace('_', ' ')}
      </p>
      {o.object_type === 'voice_note' ? (
        <VoiceNotePlayer url={o.url ?? null} seed={o.id} />
      ) : o.object_type === 'image' ? (
        o.url ? (
          <button type="button" onClick={() => onOpen(o)} style={{ ...plainBtn, cursor: 'zoom-in' }} title="Open image">
            <img src={o.url} alt={o.filename ?? 'image'} style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 3 }} />
          </button>
        ) : (
          <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>{o.filename ?? o.content}</p>
        )
      ) : o.object_type === 'file' ? (
        <a href={o.url ?? '#'} target="_blank" rel="noreferrer" download={o.filename ?? undefined}
           className="br-sans" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink)', textDecoration: 'none' }}>
          <span aria-hidden style={{ fontSize: 22 }}>📄</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15, color: 'var(--accent)', wordBreak: 'break-word' }}>{o.filename ?? o.content}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{fileMeta(o.mime, o.size)}</span>
          </span>
        </a>
      ) : o.object_type === 'link' ? (
        <a href={o.content.startsWith('http') ? o.content : `https://${o.content}`} target="_blank" rel="noreferrer"
           className="br-sans" style={{ color: 'var(--accent)', fontSize: 15, wordBreak: 'break-word' }}>
          {o.content}
        </a>
      ) : (
        // Note: a clamped snippet in the grid; click opens the full text in a modal.
        <button type="button" onClick={() => onOpen(o)} style={{ ...plainBtn, cursor: 'pointer' }} title="Read the full note">
          <span className="br-serif" style={{
            display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            fontSize: 17, color: 'var(--ink)', lineHeight: 1.4, wordBreak: 'break-word',
          }}>{o.content}</span>
          {o.content.length > 240 && (
            <span className="br-sans" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--accent)' }}>Read more</span>
          )}
        </button>
      )}
      <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '12px 0 0' }}>{o.author_ref} · {formatStamp(o.created_at)}</p>
    </article>
  );
}

// Text-entry keys: Enter submits; Ctrl or Cmd + Enter inserts a line break at
// the cursor (so you can write multi-line messages and notes).
function composerKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  setValue: (v: string) => void,
  submit: () => void,
) {
  if (e.key !== 'Enter') return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const ta = e.currentTarget;
    const s = ta.selectionStart ?? value.length;
    const en = ta.selectionEnd ?? value.length;
    setValue(value.slice(0, s) + '\n' + value.slice(en));
    requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = s + 1; } catch { /* noop */ } });
  } else {
    e.preventDefault();
    submit();
  }
}

// Render a chat message, highlighting @mentions of known room members.
function MentionText({ text, memberRefs }: { text: string; memberRefs: Set<string> }) {
  const parts = text.split(/(@[A-Za-z0-9_-]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('@') && memberRefs.has(p.slice(1))
          ? <span key={i} style={{ color: 'var(--accent)', fontWeight: 500 }}>{p}</span>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

// Compact date + time for a table item, e.g. "13 Jul, 14:32".
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// A voice note: play/pause over the waveform. Falls back to the bare waveform
// for older notes that have no stored audio.
function VoiceNotePlayer({ url, seed }: { url: string | null; seed: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  if (!url) return <Waveform seed={seed} />;
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { void a.play().catch(() => setPlaying(false)); } else { a.pause(); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 999, border: '1px solid var(--accent)', background: playing ? 'var(--accent)' : 'transparent', color: playing ? 'var(--bg)' : 'var(--accent)', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >{playing ? '❙❙' : '▶'}</button>
      <div style={{ flex: 1 }}><Waveform seed={seed} /></div>
      <audio
        ref={audioRef} src={url} preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      />
    </div>
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
