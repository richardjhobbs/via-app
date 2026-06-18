import sharp from 'sharp';

const CREAM = { r: 0xfa, g: 0xf7, b: 0xf2, alpha: 1 };
const AVATAR = 'public/via-avatar.png';   // 512x512 cream bg + dark VIA wordmark
const INK_LOGO = 'public/via-logo-ink.png'; // 920x381 transparent, ink wordmark
const LOGO_AR = 381 / 920;

// 1. Square PWA icons straight from the avatar (cream bg, full-bleed wordmark)
const square = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-384.png', 384],
  ['public/icons/icon-512.png', 512],
  ['public/icons/apple-touch-icon.png', 180],
];
for (const [out, size] of square) {
  await sharp(AVATAR).resize(size, size, { fit: 'cover' }).png().toFile(out);
  console.log('wrote', out, size);
}

// 2. Maskable: wordmark shrunk into the safe zone on a cream canvas
{
  const W = 512;
  const logoW = 300;
  const logoH = Math.round(logoW * LOGO_AR);
  const logo = await sharp(INK_LOGO).resize(logoW, logoH).png().toBuffer();
  await sharp({ create: { width: W, height: W, channels: 4, background: CREAM } })
    .composite([{ input: logo, left: Math.round((W - logoW) / 2), top: Math.round((W - logoH) / 2) }])
    .png()
    .toFile('public/icons/maskable-512.png');
  console.log('wrote maskable-512.png');
}

// 3. OG default: 1200x630 cream with centered ink wordmark
{
  const W = 1200, H = 630;
  const logoW = 540;
  const logoH = Math.round(logoW * LOGO_AR);
  const logo = await sharp(INK_LOGO).resize(logoW, logoH).png().toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4, background: CREAM } })
    .composite([{ input: logo, left: Math.round((W - logoW) / 2), top: Math.round((H - logoH) / 2) }])
    .jpeg({ quality: 90 })
    .toFile('public/og-default.jpg');
  console.log('wrote og-default.jpg');
}

// 4. Favicon: cream-bg SVG embedding a 64px VIA avatar raster
{
  const b64 = (await sharp(AVATAR).resize(64, 64).png().toBuffer()).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#faf7f2"/>
  <image href="data:image/png;base64,${b64}" width="32" height="32"/>
</svg>
`;
  await sharp(Buffer.from(svg)); // validate it parses as an image
  const { writeFileSync } = await import('node:fs');
  writeFileSync('public/favicon.svg', svg);
  console.log('wrote favicon.svg');
}
