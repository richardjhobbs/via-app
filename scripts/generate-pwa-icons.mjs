#!/usr/bin/env node
/**
 * One-off generator for PWA icons.
 * Outputs:
 *   public/icons/icon-192.png
 *   public/icons/icon-384.png
 *   public/icons/icon-512.png
 *   public/icons/apple-touch-icon.png  (180x180)
 *   public/icons/maskable-512.png      (512x512, R inside 80% safe zone)
 */

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'public', 'icons');
await fs.mkdir(outDir, { recursive: true });

// Maison palette (must match app/globals.css):
//   --ink: #1a1612, --bg: #faf7f2
const BG_DARK = '#1a1612';
const FG_CREAM = '#faf7f2';

// Standard tile: large serif R, full-bleed, generous size.
function tileSvg(size) {
  const r = size / 2;
  // Set the R glyph height to ~70% of canvas.
  const fontSize = Math.round(size * 0.72);
  // y is baseline; nudge slightly below center for serif optical balance.
  const y = Math.round(size * 0.745);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG_DARK}"/>
  <text x="${r}" y="${y}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${fontSize}" font-weight="400" font-style="italic" fill="${FG_CREAM}">R</text>
</svg>`;
}

// Maskable: same R but scaled to 60% of canvas so it sits inside the 80%
// safe zone with margin to spare (Android trims corners on adaptive icons).
function maskableSvg(size) {
  const r = size / 2;
  const fontSize = Math.round(size * 0.5);
  const y = Math.round(size * 0.66);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG_DARK}"/>
  <text x="${r}" y="${y}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${fontSize}" font-weight="400" font-style="italic" fill="${FG_CREAM}">R</text>
</svg>`;
}

const jobs = [
  { name: 'icon-192.png', size: 192, svg: tileSvg(192) },
  { name: 'icon-384.png', size: 384, svg: tileSvg(384) },
  { name: 'icon-512.png', size: 512, svg: tileSvg(512) },
  { name: 'apple-touch-icon.png', size: 180, svg: tileSvg(180) },
  { name: 'maskable-512.png', size: 512, svg: maskableSvg(512) },
];

for (const job of jobs) {
  const out = path.join(outDir, job.name);
  await sharp(Buffer.from(job.svg)).png({ compressionLevel: 9 }).toFile(out);
  console.log(`wrote ${out}`);
}

console.log('done.');
