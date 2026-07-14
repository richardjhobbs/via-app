'use client';

/**
 * The card studio: curate the public face of a private profile.
 *
 * Chips come from the SAVED profile (the card must be a subset of what the
 * member declared, enforced again server-side). Tapping picks an entry onto
 * the card in tap order; caps keep the card a face, not an archive. Publishing
 * is a separate explicit act with its own copy, and matching has its own
 * toggle so a member can be public without being matched.
 */
import { useCallback, useEffect, useState } from 'react';
import { TasteCard, type TasteCardView } from './TasteCard';
import { ShareButtons } from './ShareButtons';

interface ProfileFields {
  references:      string[];
  obsessions:      string[];
  aesthetic_vocab: string[];
  anti_references: string[];
  places:          string[];
  work:            string[];
  voice_text?:     string;
}

/** The first sentence of the member's spoken words: the default headline for a
 *  brand-new card, so talking alone fills the whole card. Always editable. */
function firstSentence(text: string | undefined): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const m = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  return m.trim().slice(0, 140);
}

interface CardData {
  slug:             string;
  status:           'draft' | 'published';
  display_name:     string;
  headline:         string;
  accent:           string;
  references:       string[];
  obsessions:       string[];
  anti_references:  string[];
  vocab:            string[];
  places:           string[];
  work:             string[];
  profile_version:  number | null;
  matching_enabled: boolean;
}

const CAPS = { references: 15, obsessions: 5, anti_references: 5, vocab: 6, places: 6, work: 6 } as const;

type ProfileArrayKey = 'references' | 'obsessions' | 'aesthetic_vocab' | 'anti_references' | 'places' | 'work';

const GROUPS: { cardKey: keyof typeof CAPS; profileKey: ProfileArrayKey; label: string }[] = [
  { cardKey: 'work', profileKey: 'work', label: 'Work' },
  { cardKey: 'places', profileKey: 'places', label: 'Places' },
  { cardKey: 'references', profileKey: 'references', label: 'References' },
  { cardKey: 'obsessions', profileKey: 'obsessions', label: 'Obsessions' },
  { cardKey: 'vocab', profileKey: 'aesthetic_vocab', label: 'Aesthetic' },
  { cardKey: 'anti_references', profileKey: 'anti_references', label: 'Not' },
];

const ACCENTS = ['#8a5a3c', '#4c8a5a', '#a8443a', '#8a6320', '#3c5a8a', '#6b4c8a'];

export function CardStudio({ memberRef, profile }: { memberRef: string; profile: ProfileFields }) {
  const [card, setCard] = useState<CardData | null>(null);
  const [suggestedSlug, setSuggestedSlug] = useState('');
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/backroom/taste/card?ref=${encodeURIComponent(memberRef)}`);
    if (res.ok) {
      const json = await res.json() as { card: CardData | null; suggested_slug: string; card_url: string | null };
      setCard(json.card);
      setSuggestedSlug(json.suggested_slug);
      setCardUrl(json.card_url);
    }
    setLoaded(true);
  }, [memberRef]);

  useEffect(() => { void load(); }, [load]);

  // A brand-new card starts already filled from what the member said: the
  // first entries of each field and the first sentence of their own words.
  // Talking alone produces a complete card; every part stays editable.
  function working(): CardData {
    return card ?? {
      slug: suggestedSlug, status: 'draft', display_name: '', headline: firstSentence(profile.voice_text), accent: '#8a5a3c',
      references: profile.references.slice(0, CAPS.references),
      obsessions: profile.obsessions.slice(0, CAPS.obsessions),
      anti_references: profile.anti_references.slice(0, CAPS.anti_references),
      vocab: profile.aesthetic_vocab.slice(0, CAPS.vocab),
      places: profile.places.slice(0, CAPS.places),
      work: profile.work.slice(0, CAPS.work),
      profile_version: null, matching_enabled: true,
    };
  }

  function toggleEntry(cardKey: keyof typeof CAPS, entry: string) {
    const w = working();
    const current = w[cardKey];
    const has = current.some((e) => e.toLowerCase() === entry.toLowerCase());
    const next = has
      ? current.filter((e) => e.toLowerCase() !== entry.toLowerCase())
      : current.length < CAPS[cardKey] ? [...current, entry] : current;
    setCard({ ...w, [cardKey]: next });
    setNote('');
  }

  function setField<K extends keyof CardData>(key: K, value: CardData[K]) {
    setCard({ ...working(), [key]: value });
    setNote('');
  }

  async function save(): Promise<boolean> {
    const w = working();
    setBusy(true); setError(''); setNote('');
    const res = await fetch('/api/backroom/taste/card', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: memberRef, card: {
        slug: w.slug, display_name: w.display_name, headline: w.headline, accent: w.accent,
        references: w.references, obsessions: w.obsessions, anti_references: w.anti_references,
        vocab: w.vocab, places: w.places, work: w.work, matching_enabled: w.matching_enabled,
      } }),
    });
    const json = await res.json().catch(() => ({})) as { card?: CardData; card_url?: string; error?: string };
    setBusy(false);
    if (!res.ok || !json.card) { setError(json.error || 'Could not save the card.'); return false; }
    setCard(json.card);
    setCardUrl(json.card_url ?? null);
    setNote('Card saved.');
    return true;
  }

  async function setPublished(publish: boolean) {
    if (publish && !(await save())) return;
    setBusy(true); setError(''); setNote('');
    const res = await fetch('/api/backroom/taste/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: memberRef, action: publish ? 'publish' : 'unpublish' }),
    });
    const json = await res.json().catch(() => ({})) as { card?: CardData; card_url?: string; error?: string };
    setBusy(false);
    if (!res.ok || !json.card) { setError(json.error || 'Could not update the card.'); return; }
    setCard(json.card);
    setCardUrl(json.card_url ?? null);
    setNote(publish ? 'Your card is public.' : 'Your card is private again.');
  }

  async function copyLink() {
    if (!cardUrl) return;
    try { await navigator.clipboard.writeText(cardUrl); setNote('Link copied.'); } catch { setNote(cardUrl); }
  }

  if (!loaded) return null;

  const w = working();
  const hasProfileContent = GROUPS.some((g) => profile[g.profileKey].length > 0);
  if (!hasProfileContent) {
    return (
      <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink-3)' }}>
        Your card draws from your saved profile. Answer a few interview questions or fill in the fields above first.
      </p>
    );
  }

  const preview: TasteCardView = {
    slug: w.slug || suggestedSlug, display_name: w.display_name, headline: w.headline, accent: w.accent,
    references: w.references, obsessions: w.obsessions, anti_references: w.anti_references, vocab: w.vocab,
    places: w.places, work: w.work,
    profile_version: w.profile_version,
  };
  const published = w.status === 'published';

  return (
    <div>
      {/* Curation chips */}
      {GROUPS.map(({ cardKey, profileKey, label }) => {
        const declared = profile[profileKey];
        if (!declared.length) return null;
        const chosen = w[cardKey];
        return (
          <div key={cardKey} style={{ marginBottom: 16 }}>
            <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px' }}>
              {label} <span style={{ textTransform: 'none', letterSpacing: 0 }}>, pick up to {CAPS[cardKey]}</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {declared.map((entry) => {
                const idx = chosen.findIndex((e) => e.toLowerCase() === entry.toLowerCase());
                const on = idx >= 0;
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => toggleEntry(cardKey, entry)}
                    className="br-sans"
                    style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                      border: `1px solid ${on ? w.accent : 'var(--line-strong)'}`,
                      background: on ? w.accent : 'transparent',
                      color: on ? 'var(--bg)' : 'var(--ink-2)',
                    }}
                  >
                    {on ? `${idx + 1} · ${entry}` : entry}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Name, headline, slug, accent */}
      <div style={{ display: 'grid', gap: 12, marginTop: 8, marginBottom: 16 }}>
        <label className="br-sans" style={miniLabel}>
          Name on the card
          <input className="br-sans" value={w.display_name} onChange={(e) => setField('display_name', e.target.value)} placeholder="How you want to be named" style={inputStyle} />
        </label>
        <label className="br-sans" style={miniLabel}>
          One line, in your words <span style={{ textTransform: 'none', letterSpacing: 0 }}>, drawn from what you said, edit freely</span>
          <input className="br-sans" value={w.headline} onChange={(e) => setField('headline', e.target.value.slice(0, 140))} placeholder="What you make, or how you see things" style={inputStyle} />
        </label>
        <label className="br-sans" style={miniLabel}>
          Address
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>app.getvia.xyz/taste/</span>
            <input
              className="br-sans"
              value={w.slug}
              onChange={(e) => setField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder={suggestedSlug}
              style={{ ...inputStyle, flex: 1 }}
            />
          </span>
        </label>
        <div>
          <p className="br-sans" style={{ ...miniLabel, marginBottom: 6 }}>Accent</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCENTS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setField('accent', hex)}
                aria-label={`Accent ${hex}`}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: hex, cursor: 'pointer',
                  border: w.accent === hex ? '2px solid var(--ink)' : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div style={{ margin: '20px 0' }}>
        <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>
          Preview, exactly what the world sees
        </p>
        <TasteCard card={preview} />
      </div>

      {/* Matching toggle */}
      <label className="br-sans" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ink-2)', marginBottom: 16, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={w.matching_enabled}
          onChange={(e) => setField('matching_enabled', e.target.checked)}
          style={{ accentColor: w.accent, width: 16, height: 16 }}
        />
        Let VIA propose introductions from this card. A few a month at most; you can always say no.
      </label>

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button type="button" onClick={() => void save()} disabled={busy} className="br-sans" style={buttonStyle(false)}>
          Save card
        </button>
        <button type="button" onClick={() => void setPublished(!published)} disabled={busy} className="br-sans" style={buttonStyle(!published)}>
          {published ? 'Make it private' : 'Publish'}
        </button>
        {published && cardUrl && (
          <>
            <button type="button" onClick={() => void copyLink()} className="br-sans" style={buttonStyle(false)}>Copy link</button>
            <a className="br-sans" href={`/api/taste/${w.slug}/image?format=story`} style={{ ...buttonStyle(false), textDecoration: 'none', display: 'inline-block' }}>Story image</a>
            <a className="br-sans" href={`/api/taste/${w.slug}/image?format=square`} style={{ ...buttonStyle(false), textDecoration: 'none', display: 'inline-block' }}>Square image</a>
          </>
        )}
      </div>
      {published && cardUrl && (
        <div style={{ marginTop: 16, border: '1px solid var(--line)', background: 'var(--paper)', borderRadius: 6, padding: '14px 16px' }}>
          <p className="br-serif" style={{ fontSize: 18, margin: '0 0 4px', color: 'var(--ink)' }}>Bring someone in</p>
          <p className="br-sans" style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 12px', lineHeight: 1.5 }}>
            The network is only as good as who is in it. Share your card and invite the people you would want to meet here.
          </p>
          <ShareButtons cardUrl={cardUrl} accent={w.accent} />
        </div>
      )}
      {!published && (
        <p className="br-sans" style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '10px 0 0' }}>
          Publishing makes this card a public page anyone can see and share, and lets other members knock for an introduction. Your full profile stays private either way.
        </p>
      )}
      {note && <p className="br-sans" style={{ fontSize: 13, color: 'var(--live)', margin: '10px 0 0' }}>{note}</p>}
      {error && <p className="br-sans" style={{ fontSize: 13, color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>}
    </div>
  );
}

const miniLabel: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--paper)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
  borderRadius: 4,
  padding: '9px 12px',
  fontSize: 15,
  letterSpacing: 0,
  textTransform: 'none',
  fontFamily: 'inherit',
};

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: '10px 20px',
    borderRadius: 999,
    border: '1px solid var(--ink)',
    background: primary ? 'var(--ink)' : 'transparent',
    color: primary ? 'var(--bg)' : 'var(--ink)',
    fontSize: 14,
    cursor: 'pointer',
  };
}
