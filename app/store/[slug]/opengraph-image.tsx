import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { getStoreCardBySlug } from '@/lib/app/backroom/store-card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A product made together on VIA';

const PAPER = '#f4efe6';
const CARD = '#fbf7ef';
const INK = '#211b15';
const INK2 = '#4a4136';
const INK3 = '#7c7060';
const ACCENT = '#8a5a3c';
const LINE = 'rgba(33,27,21,0.16)';

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getStoreCardBySlug(slug);
  const dir = join(process.cwd(), 'assets', 'fonts');
  const [serif, serifItalic, sans, sansSemibold] = await Promise.all([
    readFile(join(dir, 'newsreader-400.ttf')),
    readFile(join(dir, 'newsreader-italic-400.ttf')),
    readFile(join(dir, 'sourcesans3-400.ttf')),
    readFile(join(dir, 'sourcesans3-600.ttf')),
  ]);
  const fonts = [
    { name: 'Newsreader', data: serif, style: 'normal' as const, weight: 400 as const },
    { name: 'Newsreader', data: serifItalic, style: 'italic' as const, weight: 400 as const },
    { name: 'SourceSans', data: sans, style: 'normal' as const, weight: 400 as const },
    { name: 'SourceSans', data: sansSemibold, style: 'normal' as const, weight: 600 as const },
  ];

  if (!card) {
    return new ImageResponse(
      (<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: PAPER, color: INK3, fontSize: 40 }}>VIA</div>),
      { ...size, fonts },
    );
  }
  const p = card.products[0];

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', backgroundColor: PAPER, padding: 36 }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: CARD, border: `1px solid ${LINE}`, borderTop: `10px solid ${ACCENT}`, padding: 56 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'SourceSans', fontSize: 18, letterSpacing: '0.22em', color: INK3 }}>MADE TOGETHER ON VIA</span>
            <span style={{ fontFamily: 'SourceSans', fontSize: 18, letterSpacing: '0.22em', color: INK3 }}>VIA</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34, flexGrow: 1 }}>
            <span style={{ fontFamily: 'Newsreader', fontSize: 58, color: INK, lineHeight: 1.05 }}>{p ? p.title : card.store_name}</span>
            {p?.description ? (
              <span style={{ fontFamily: 'Newsreader', fontStyle: 'italic', fontSize: 26, color: INK2, marginTop: 14, lineHeight: 1.3 }}>{p.description.slice(0, 120)}</span>
            ) : null}
            {p ? (
              <span style={{ fontFamily: 'SourceSans', fontSize: 22, color: INK2, marginTop: 26 }}>
                By {p.cocreators.map((c) => `${c.name} (${c.pct}%)`).join('  ·  ')}
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 20 }}>
            <span style={{ fontFamily: 'Newsreader', fontSize: 34, color: ACCENT }}>{p ? `${p.price_usd} USDC` : ''}</span>
            <span style={{ fontFamily: 'SourceSans', fontSize: 18, color: INK3 }}>app.getvia.xyz/store/{card.slug}</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
