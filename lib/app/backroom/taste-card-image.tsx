/**
 * Taste card image renderer: the shareable artifact.
 *
 * One builder behind the OG image (1200x630), the story download (1080x1920)
 * and the square download (1080x1080). Paper and ink, Newsreader for names and
 * entries, Source Sans for functional text, the member's accent as the single
 * colour. Fonts are read off disk (assets/fonts, traced into the bundle via
 * next.config outputFileTracingIncludes) so nothing is fetched at render time.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { TasteCard } from './taste-cards';

export type CardImageFormat = 'og' | 'story' | 'square';

export const CARD_IMAGE_SIZES: Record<CardImageFormat, { width: number; height: number }> = {
  og:     { width: 1200, height: 630 },
  story:  { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

const PAPER = '#f4efe6';
const CARD  = '#fbf7ef';
const INK   = '#211b15';
const INK2  = '#4a4136';
const INK3  = '#7c7060';
const LINE  = 'rgba(33,27,21,0.16)';

let fontsPromise: Promise<{ serif: Buffer; serifItalic: Buffer; sans: Buffer; sansSemibold: Buffer }> | null = null;

function loadFonts() {
  if (!fontsPromise) {
    const dir = join(process.cwd(), 'assets', 'fonts');
    fontsPromise = Promise.all([
      readFile(join(dir, 'newsreader-400.ttf')),
      readFile(join(dir, 'newsreader-italic-400.ttf')),
      readFile(join(dir, 'sourcesans3-400.ttf')),
      readFile(join(dir, 'sourcesans3-600.ttf')),
    ]).then(([serif, serifItalic, sans, sansSemibold]) => ({ serif, serifItalic, sans, sansSemibold }));
  }
  return fontsPromise;
}

interface Section { label: string; text: string; italic?: boolean }

/** Join a section's entries, bounded so a fixed-height canvas never clips. */
function joined(entries: string[], maxChars: number): string {
  const text = entries.join('  ·  ');
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' · '), 40))} ...`;
}

function sectionsFor(card: TasteCard, maxChars: number): Section[] {
  const out: Section[] = [];
  if (card.work.length) out.push({ label: 'Work', text: joined(card.work, maxChars) });
  if (card.places.length) out.push({ label: 'Places', text: joined(card.places, maxChars) });
  if (card.references.length) out.push({ label: 'References', text: joined(card.references, maxChars) });
  if (card.obsessions.length) out.push({ label: 'Obsessions', text: joined(card.obsessions, maxChars) });
  if (card.vocab.length) out.push({ label: 'Aesthetic', text: joined(card.vocab, maxChars) });
  if (card.anti_references.length) out.push({ label: 'Not', text: joined(card.anti_references, maxChars), italic: true });
  return out;
}

/** The og canvas is short: show only the first few sections so nothing clips. */
function limitForFormat(sections: Section[], tall: boolean): Section[] {
  return tall ? sections : sections.slice(0, 4);
}

export async function renderCardImage(card: TasteCard, format: CardImageFormat): Promise<ImageResponse> {
  const { width, height } = CARD_IMAGE_SIZES[format];
  const fonts = await loadFonts();
  const tall = format !== 'og';
  const pad = tall ? 72 : 44;
  const nameSize = tall ? 76 : 46;
  const entrySize = tall ? 40 : 25;
  const labelSize = tall ? 24 : 15;
  // The og canvas is short; bound each section to roughly one wrapped line and
  // cap how many sections appear so the fixed height never clips.
  const sections = limitForFormat(sectionsFor(card, tall ? 160 : 76), tall);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: PAPER,
          padding: tall ? 48 : 36,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: CARD,
            border: `1px solid ${LINE}`,
            borderTop: `10px solid ${card.accent}`,
            padding: pad,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'SourceSans', fontSize: labelSize, letterSpacing: '0.22em', color: INK3 }}>
              TASTE CARD
            </span>
            <span style={{ fontFamily: 'SourceSans', fontSize: labelSize, letterSpacing: '0.22em', color: INK3 }}>
              VIA
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: tall ? 48 : 16 }}>
            <span style={{ fontFamily: 'Newsreader', fontSize: nameSize, color: INK, lineHeight: 1.05 }}>
              {card.display_name || card.slug}
            </span>
            {card.headline ? (
              <span style={{ fontFamily: 'Newsreader', fontStyle: 'italic', fontSize: Math.round(nameSize * 0.44), color: INK2, marginTop: tall ? 14 : 8, lineHeight: 1.3 }}>
                {card.headline}
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: tall ? 56 : 18, flexGrow: 1, overflow: 'hidden' }}>
            {sections.map((s) => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', marginBottom: tall ? 40 : 13 }}>
                <span style={{ fontFamily: 'SourceSans', fontSize: labelSize, fontWeight: 600, letterSpacing: '0.2em', color: s.label === 'Not' ? card.accent : INK3 }}>
                  {s.label.toUpperCase()}
                </span>
                <span
                  style={{
                    fontFamily: 'Newsreader',
                    fontStyle: s.italic ? 'italic' : 'normal',
                    fontSize: entrySize,
                    color: INK,
                    marginTop: tall ? 8 : 4,
                    lineHeight: 1.3,
                  }}
                >
                  {s.text}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: tall ? 32 : 14 }}>
            <span style={{ fontFamily: 'SourceSans', fontSize: labelSize, color: INK3 }}>
              {card.profile_version ? `Edition ${card.profile_version}` : 'app.getvia.xyz'}
            </span>
            <span style={{ fontFamily: 'SourceSans', fontSize: labelSize, color: INK3 }}>
              app.getvia.xyz/taste/{card.slug}
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: 'Newsreader', data: fonts.serif, style: 'normal', weight: 400 },
        { name: 'Newsreader', data: fonts.serifItalic, style: 'italic', weight: 400 },
        { name: 'SourceSans', data: fonts.sans, style: 'normal', weight: 400 },
        { name: 'SourceSans', data: fonts.sansSemibold, style: 'normal', weight: 600 },
      ],
    },
  );
}
