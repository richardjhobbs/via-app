'use client';

/**
 * The You surface. The taste interview (voice-led) and the plain-text edit of
 * the profile it produces. A conversation, not a form: hold to speak to answer,
 * VIA merges only what you said, and every field stays editable in your words.
 */
import { useCallback, useEffect, useState } from 'react';
import { HoldToSpeak } from './HoldToSpeak';

interface Fields {
  references:      string[];
  obsessions:      string[];
  aesthetic_vocab: string[];
  anti_references: string[];
  voice_text:      string;
}
interface Profile extends Fields { id: string | null; version: number; }

const EMPTY: Profile = { id: null, version: 0, references: [], obsessions: [], aesthetic_vocab: [], anti_references: [], voice_text: '' };

const ARRAY_FIELDS: { key: keyof Fields; label: string; hint: string }[] = [
  { key: 'references', label: 'References', hint: 'records, films, designers, eras, places you love' },
  { key: 'obsessions', label: 'Obsessions', hint: 'what you keep returning to' },
  { key: 'aesthetic_vocab', label: 'Aesthetic', hint: 'words for how things should feel' },
  { key: 'anti_references', label: 'Not you', hint: 'what you reject' },
];

export function YouClient({ handle }: { handle: string }) {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [question, setQuestion] = useState('Tell me what you keep coming back to, in any medium.');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!handle) { setLoaded(true); return; }
    (async () => {
      const res = await fetch(`/api/backroom/taste?handle=${encodeURIComponent(handle)}`);
      if (res.ok) {
        const json = await res.json() as { profile: Profile };
        setProfile({ ...EMPTY, ...json.profile });
      }
      setLoaded(true);
    })();
  }, [handle]);

  const onAnswer = useCallback(async (blob: Blob) => {
    setBusy(true);
    setSaved(false);
    const form = new FormData();
    form.append('handle', handle);
    form.append('audio', blob, 'answer');
    const res = await fetch('/api/backroom/taste/interview', { method: 'POST', body: form });
    if (res.ok) {
      const json = await res.json() as { transcript: string; profile: Profile; next_question: string };
      setTranscript(json.transcript);
      setProfile({ ...EMPTY, ...json.profile });
      setQuestion(json.next_question);
    }
    setBusy(false);
  }, [handle]);

  function setArray(key: keyof Fields, text: string) {
    setProfile((p) => ({ ...p, [key]: text.split('\n').map((s) => s.trim()).filter(Boolean) }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    const res = await fetch('/api/backroom/taste', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, fields: {
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
    }
    setBusy(false);
  }

  if (!handle) {
    return (
      <main style={{ maxWidth: 620, margin: '0 auto', padding: '64px 20px' }}>
        <p className="br-sans" style={{ color: 'var(--ink-2)' }}>Open this with your member handle, for example /you?handle=yourname.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px 180px' }}>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>You</p>
      <h1 className="br-serif" style={{ fontSize: 32, fontWeight: 400, margin: '8px 0 24px' }}>Your taste, in your words</h1>

      {/* Interview */}
      <section style={{ borderTop: '1px solid var(--line)', paddingTop: 20, marginBottom: 28 }}>
        <p className="br-serif" style={{ fontSize: 22, margin: '0 0 6px', color: 'var(--ink)' }}>{question}</p>
        {transcript && <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>You said: {transcript}</p>}
        {busy && <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)' }}>One moment...</p>}
      </section>

      {/* Editable profile */}
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
