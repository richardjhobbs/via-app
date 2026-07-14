/**
 * The taste card, rendered. Pure presentation: the public page and the /you
 * studio preview both use this, so what the member previews is exactly what
 * the world sees. Paper and ink with one accent; anti-references ("Not") are
 * the accent-marked section because what someone rejects is the sharpest
 * signal of taste.
 */

export interface TasteCardView {
  slug:            string;
  display_name:    string;
  headline:        string;
  accent:          string;
  references:      string[];
  obsessions:      string[];
  anti_references: string[];
  vocab:           string[];
  places:          string[];
  work:            string[];
  profile_version?: number | null;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  margin: 0,
};

function Section({ label, entries, accent, italic }: { label: string; entries: string[]; accent?: string; italic?: boolean }) {
  if (!entries.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <p className="br-sans" style={{ ...labelStyle, color: accent ?? 'var(--ink-3)', fontWeight: 600 }}>{label}</p>
      <p className="br-serif" style={{ fontSize: 19, lineHeight: 1.45, margin: '6px 0 0', color: 'var(--ink)', fontStyle: italic ? 'italic' : 'normal' }}>
        {entries.join('  ·  ')}
      </p>
    </div>
  );
}

export function TasteCard({ card }: { card: TasteCardView }) {
  return (
    <article
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--line)',
        borderTop: `6px solid ${card.accent}`,
        padding: '28px 28px 20px',
        maxWidth: 560,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
        <span className="br-sans" style={labelStyle}>Taste card</span>
        <span className="br-sans" style={labelStyle}>VIA</span>
      </div>

      <h2 className="br-serif" style={{ fontSize: 34, fontWeight: 400, margin: 0, lineHeight: 1.1, color: 'var(--ink)' }}>
        {card.display_name || card.slug}
      </h2>
      {card.headline && (
        <p className="br-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--ink-2)', margin: '10px 0 0', lineHeight: 1.4 }}>
          {card.headline}
        </p>
      )}

      <div style={{ marginTop: 26 }}>
        <Section label="Work" entries={card.work} />
        <Section label="Places" entries={card.places} />
        <Section label="References" entries={card.references} />
        <Section label="Obsessions" entries={card.obsessions} />
        <Section label="Aesthetic" entries={card.vocab} />
        <Section label="Not" entries={card.anti_references} accent={card.accent} italic />
      </div>

      <div
        className="br-sans"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--line)',
          paddingTop: 12,
          marginTop: 8,
          fontSize: 12,
          color: 'var(--ink-3)',
        }}
      >
        <span>{card.profile_version ? `Edition ${card.profile_version}` : 'app.getvia.xyz'}</span>
        <span>app.getvia.xyz/taste/{card.slug}</span>
      </div>
    </article>
  );
}
