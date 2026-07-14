'use client';

/**
 * The You surface. The taste interview (voice-led) and the plain-text edit of
 * the profile it produces, then the card studio: the shareable, publish-opt-in
 * face of the profile. A conversation, not a form: hold to speak to answer,
 * VIA merges only what you said, and every field stays editable in your words.
 *
 * Any of the four member kinds can hold a profile. An RRG brand with no
 * profile yet can ask for a DRAFT from its brand story; nothing drafted goes
 * live until the human saves it.
 */
import { useCallback, useEffect, useState } from 'react';
import { HoldToSpeak } from './HoldToSpeak';
import { CardStudio } from './CardStudio';

interface Fields {
  references:      string[];
  obsessions:      string[];
  aesthetic_vocab: string[];
  anti_references: string[];
  voice_text:      string;
}
interface Profile extends Fields { id: string | null; version: number; }

export interface YouMember { platform: 'via' | 'rrg'; type: 'buyer' | 'seller'; ref: string; label: string; }

const EMPTY: Profile = { id: null, version: 0, references: [], obsessions: [], aesthetic_vocab: [], anti_references: [], voice_text: '' };

const ARRAY_FIELDS: { key: keyof Fields; label: string; hint: string }[] = [
  { key: 'references', label: 'References', hint: 'records, films, designers, eras, places you love' },
  { key: 'obsessions', label: 'Obsessions', hint: 'what you keep returning to' },
  { key: 'aesthetic_vocab', label: 'Aesthetic', hint: 'words for how things should feel' },
  { key: 'anti_references', label: 'Not you', hint: 'what you reject' },
];

export function YouClient({ member, members }: { member: YouMember | null; members: YouMember[] }) {
  const ref = member?.ref ?? '';
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [question, setQuestion] = useState('Tell me what you keep coming back to, in any medium.');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [complete, setComplete] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!ref) { setLoaded(true); return; }
    (async () => {
      const res = await fetch(`/api/backroom/taste?ref=${encodeURIComponent(ref)}`);
      if (res.ok) {
        const json = await res.json() as { profile: Profile; draft: Profile | null };
        if (json.profile?.id) {
          setProfile({ ...EMPTY, ...json.profile });
        } else if (json.draft) {
          setProfile({ ...EMPTY, ...json.draft, id: null, version: 0 });
          setIsDraft(true);
        } else {
          setProfile({ ...EMPTY, ...json.profile });
        }
      }
      setLoaded(true);
    })();
  }, [ref]);

  const onAnswer = useCallback(async (blob: Blob) => {
    setBusy(true);
    setSaved(false);
    const form = new FormData();
    form.append('ref', ref);
    form.append('audio', blob, 'answer');
    const res = await fetch('/api/backroom/taste/interview', { method: 'POST', body: form });
    if (res.ok) {
      const json = await res.json() as { transcript: string; profile: Profile; next_question: string; complete: boolean };
      setTranscript(json.transcript);
      setProfile({ ...EMPTY, ...json.profile });
      setQuestion(json.next_question);
      setComplete(json.complete);
      setIsDraft(false);
    }
    setBusy(false);
  }, [ref]);

  function setArray(key: keyof Fields, text: string) {
    setProfile((p) => ({ ...p, [key]: text.split('\n').map((s) => s.trim()).filter(Boolean) }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    const res = await fetch('/api/backroom/taste', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, fields: {
        references: profile.references,
        obsessions: profile.obsessions,
        aesthetic_vocab: profile.aesthetic_vocab,
        anti_references: profile.anti_references,
        voice_text: profile.voice_text,
      } }),
    });
    if (res.ok) {
      const json = await res.json() as { profile: Profile };
      setProfile({ ...EMPTY, ...json.profile });
      setSaved(true);
      setIsDraft(false);
    }
    setBusy(false);
  }

  async function seedFromBrand() {
    setSeeding(true);
    const res = await fetch('/api/backroom/taste/seed-brand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref }),
    });
    if (res.ok) {
      const json = await res.json() as { fields: Fields };
      setProfile((p) => ({ ...p, ...json.fields }));
      setIsDraft(true);
      setSaved(false);
    }
    setSeeding(false);
  }

  if (!member) {
    return (
      <main style={{ maxWidth: 620, margin: '0 auto', padding: '64px 20px' }}>
        <p className="br-sans" style={{ color: 'var(--ink-2)' }}>
          Sign in first: your taste belongs to your agent. <a href="/backroom" style={{ color: 'var(--accent)' }}>Go to the Back Room</a>.
        </p>
      </main>
    );
  }

  const profileEmpty = !profile.references.length && !profile.obsessions.length
    && !profile.aesthetic_vocab.length && !profile.anti_references.length;
  const showBrandSeed = loaded && profileEmpty && member.platform === 'rrg' && member.type === 'seller';

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px 180px' }}>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>You</p>
      <h1 className="br-serif" style={{ fontSize: 32, fontWeight: 400, margin: '8px 0 12px' }}>Your taste, in your words</h1>
      <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>
        Just talk. Hold the button at the bottom of the screen and answer out loud.
        Everything you say fills every field on this page, and those fields become your card.
        You can edit any word by hand afterwards.
      </p>

      {members.length > 1 && (
        <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 20px' }}>
          As:{' '}
          {members.map((m, i) => (
            <span key={`${m.platform}-${m.type}-${m.ref}`}>
              {i > 0 && ' / '}
              {m.ref === ref
                ? <strong style={{ color: 'var(--ink)' }}>{m.label}</strong>
                : <a href={`/you?ref=${encodeURIComponent(m.ref)}`} style={{ color: 'var(--accent)' }}>{m.label}</a>}
            </span>
          ))}
        </p>
      )}

      {/* Interview */}
      <section style={{ borderTop: '1px solid var(--line)', paddingTop: 20, marginBottom: 28 }}>
        <p className="br-serif" style={{ fontSize: 22, margin: '0 0 6px', color: 'var(--ink)' }}>{question}</p>
        {transcript && <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>You said: {transcript}</p>}
        {busy && <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)' }}>One moment...</p>}
      </section>

      {showBrandSeed && (
        <section style={{ border: '1px solid var(--line-strong)', background: 'var(--paper)', padding: '16px 18px', marginBottom: 24 }}>
          <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: '0 0 10px' }}>
            Start from your brand story if you like: VIA drafts a profile from what your brand already says and sells. It stays a draft until you edit and save it.
          </p>
          <button type="button" onClick={() => void seedFromBrand()} disabled={seeding} className="br-sans"
            style={{ padding: '10px 20px', borderRadius: 999, border: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)', fontSize: 14, cursor: 'pointer', opacity: seeding ? 0.6 : 1 }}>
            {seeding ? 'Drafting...' : 'Draft from your brand story'}
          </button>
        </section>
      )}

      {isDraft && (
        <p className="br-sans" style={{ fontSize: 13, color: 'var(--warning)', margin: '0 0 16px' }}>
          DRAFT: this was written from your brand story, not by you. Edit anything, then Save to make it yours. Nothing is live until you do.
        </p>
      )}

      {/* Editable profile */}
      {loaded && (
        <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 14px' }}>
          What you have said so far <span style={{ textTransform: 'none', letterSpacing: 0 }}>, filled by talking, editable by hand</span>
        </p>
      )}
      {loaded && ARRAY_FIELDS.map(({ key, label, hint }) => (
        <div key={key} style={{ marginBottom: 20 }}>
          <label className="br-sans" style={{ display: 'block', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
            {label} <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)' }}>, {hint}</span>
          </label>
          <textarea
            className="br-sans"
            value={(profile[key] as string[]).join('\n')}
            onChange={(e) => setArray(key, e.target.value)}
            rows={Math.max(2, (profile[key] as string[]).length + 1)}
            placeholder="One per line"
            style={fieldStyle}
          />
        </div>
      ))}

      {loaded && (
        <div style={{ marginBottom: 20 }}>
          <label className="br-sans" style={{ display: 'block', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>In your words</label>
          <textarea
            className="br-sans"
            value={profile.voice_text}
            onChange={(e) => { setProfile((p) => ({ ...p, voice_text: e.target.value })); setSaved(false); }}
            rows={5}
            style={fieldStyle}
          />
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="br-sans"
        style={{
          padding: '12px 24px', borderRadius: 999, border: '1px solid var(--ink)',
          background: saved ? 'transparent' : 'var(--ink)', color: saved ? 'var(--ink)' : 'var(--bg)',
          fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >
        {saved ? 'Saved' : 'Save'}
      </button>

      {/* The card: the shareable face of the profile */}
      {loaded && !profileEmpty && !isDraft && (
        <section style={{ borderTop: '1px solid var(--line)', marginTop: 40, paddingTop: 24 }}>
          <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: 0 }}>Your card</p>
          <h2 className="br-serif" style={{ fontSize: 24, fontWeight: 400, margin: '8px 0 6px' }}>
            {complete ? 'Your VIA knows you now. Make your card.' : 'The face of your profile'}
          </h2>
          <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-2)', margin: '0 0 18px' }}>
            Pick what goes public. The card is a page you can share anywhere; the rest of your profile stays yours.
          </p>
          <CardStudio memberRef={ref} profile={{
            references: profile.references,
            obsessions: profile.obsessions,
            aesthetic_vocab: profile.aesthetic_vocab,
            anti_references: profile.anti_references,
            voice_text: profile.voice_text,
          }} />
        </section>
      )}

      <HoldToSpeak onUtterance={onAnswer} />
    </main>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--paper)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
  borderRadius: 4,
  padding: '10px 12px',
  fontSize: 15,
  lineHeight: 1.5,
  resize: 'vertical',
  fontFamily: 'inherit',
};
