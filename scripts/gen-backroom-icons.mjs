/**
 * One-off: generate the Back Room PWA icon set from an inline SVG (no design
 * dependency, no runtime image work). Paper ground with an ink arch-top door,
 * matching the Back Room's [data-skin="backroom"] palette (--bg #f4efe6, ink
 * #211b15). Run once, commit the PNGs:
 *
 *   node scripts/gen-backroom-icons.mjs
 *
 * Outputs to public/icons/backroom/: icon-192/384/512 (purpose any),
 * maskable-512 (extra padding for Android's safe zone), apple-touch-icon (180,
 * opaque paper bg since iOS ignores transparency).
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons', 'backroom');
const PAPER = '#f4efe6';
const INK = '#211b15';

// An arch-top door, centred on a 512 canvas. `scale` shrinks the door toward
// the centre so the maskable variant keeps clear of Android's masked edges.
function svg(scale) {
  const door = `
    <g transform="translate(256,256) scale(${scale}) translate(-256,-256)">
      <path d="M166,402 L166,220 A90,90 0 0 1 346,220 L346,402 Z" fill="${INK}"/>
      <circle cx="312" cy="300" r="13" fill="${PAPER}"/>
      <rect x="146" y="402" width="220" height="14" rx="4" fill="${INK}"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${PAPER}"/>${door}
  </svg>`;
}

const TIGHT = Buffer.from(svg(1));
const PADDED = Buffer.from(svg(0.62));

async function main() {
  await mkdir(OUT, { recursive: true });
  const jobs = [
    ['icon-192.png', TIGHT, 192],
    ['icon-384.png', TIGHT, 384],
    ['icon-512.png', TIGHT, 512],
    ['maskable-512.png', PADDED, 512],
    ['apple-touch-icon.png', TIGHT, 180],
  ];
  for (const [name, buf, size] of jobs) {
    await sharp(buf).resize(size, size).png().toFile(join(OUT, name));
    console.log('wrote', name, `${size}x${size}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
