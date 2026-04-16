/**
 * scripts/scrape-vestiaire.mjs
 *
 * One-shot scraper for the 5 Vestiaire URLs Richard supplied for the
 * Maison Archive demo. Builds data/maison-archive-input.json and
 * downloads the primary image for each item.
 *
 * Vestiaire serves JSON-LD with brand/name/description/image and OG meta
 * with title (which includes brand/color/size/material). Pricing arrives
 * in SGD due to geo (this client is in Singapore); we convert at a
 * fixed SGD→EUR rate (0.69) for the demo. Conversion rate documented.
 *
 * Usage:
 *   node scripts/scrape-vestiaire.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve, basename } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const SGD_TO_EUR = 0.69;
const OUT_JSON   = resolve(process.cwd(), 'data/maison-archive-input.json');
const IMG_DIR    = resolve(process.cwd(), 'data/maison-archive-images');

const URLS = [
  'https://www.vestiairecollective.com/men-clothing/jackets/ralph-lauren-double-rl/beige-suede-ralph-lauren-double-rl-jacket-66050070.shtml',
  'https://www.vestiairecollective.com/women-bags/handbags/louis-vuitton/multicolour-leather-ursula-louis-vuitton-handbag-65705786.shtml',
  'https://www.vestiairecollective.com/women-clothing/dresses/alaia/white-cotton-alaia-dress-65971101.shtml',
  'https://www.vestiairecollective.com/women-clothing/jeans/jean-paul-gaultier/blue-cotton-jean-paul-gaultier-jeans-65898762.shtml',
  'https://www.vestiairecollective.com/women-jewellery/rings/cartier/gold-yellow-gold-clash-cartier-ring-66039936.shtml',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

function pickJsonLdProduct(html) {
  const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj?.['@type'] === 'Product') return obj;
    } catch {}
  }
  return null;
}

function pickMeta(html, prop) {
  const re = new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]+)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

function pickPrice(html) {
  // Look for first "price":"NNNN" pattern (numeric, ignoring offers blocks with currency:EUR cents:-1)
  const m = html.match(/"price":"(\d+(?:\.\d+)?)"/);
  if (m) return parseFloat(m[1]);
  return null;
}

function pickCurrency(html) {
  const m = html.match(/"priceCurrency":"([A-Z]+)"/);
  return m ? m[1] : 'SGD';
}

function categoryFromUrl(url) {
  // Path segments: /{section}/{category}/{brand}/{slug}.shtml
  const m = url.match(/vestiairecollective\.com\/[^/]+\/([^/]+)\//);
  if (!m) return 'Item';
  const cat = m[1];
  const map = {
    'jackets': 'Jacket',
    'handbags': 'Handbag',
    'dresses': 'Dress',
    'jeans': 'Jeans',
    'rings': 'Ring',
  };
  return map[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

function imagesFromJsonLdProduct(jsonLd, html) {
  // JSON-LD provides one canonical image; we try to also pull adjacent
  // "_2", "_3" etc variants (Vestiaire serves multi-angle slots).
  // URL patterns observed: /produit/{id}-{N}_{V}.jpg AND /produit/{id}-{N}.jpg
  const primary = jsonLd?.image?.image;
  if (!primary) {
    const og = pickMeta(html, 'og:image');
    return og ? [og] : [];
  }
  const upgrade = (u) => u.replace(/q=\d+/, 'q=85').replace(/w=\d+(,h=\d+)?/, 'w=1500,h=1500');
  const out = [upgrade(primary)];

  // Pattern A: /produit/{slug}-{id}-{N}_{V}.jpg
  const matchA = primary.match(/(\/produit\/[^/]*?-?\d+)-(\d+)_(\d+)\.jpg/);
  if (matchA) {
    const [, base, n1, v] = matchA;
    for (let i = 2; i <= 6; i++) {
      out.push(upgrade(primary.replace(`${base}-${n1}_${v}.jpg`, `${base}-${i}_${v}.jpg`)));
    }
    return [...new Set(out)];
  }

  // Pattern B: /produit/{id}-{N}.jpg (no version suffix — used by some listings, e.g. jewelry)
  const matchB = primary.match(/(\/produit\/[^/]*?-?\d+)-(\d+)\.jpg/);
  if (matchB) {
    const [, base, n1] = matchB;
    for (let i = 2; i <= 6; i++) {
      out.push(upgrade(primary.replace(`${base}-${n1}.jpg`, `${base}-${i}.jpg`)));
    }
  }
  return [...new Set(out)];
}

function parseTitle(ogTitle, brand) {
  // og:title format: "Jacket Ralph Lauren Double Rl Beige size M International in Suede - 66050070"
  // Strip trailing " - {sku}"
  const cleaned = ogTitle.replace(/\s*-\s*\d+\s*$/, '').trim();
  return cleaned;
}

function parseSize(ogTitle) {
  const m = ogTitle.match(/size\s+([A-Z0-9.]+(?:\s+[A-Z]+)?)/i);
  return m ? m[1].trim() : 'one size';
}

// Node fetch is fingerprinted by Cloudflare/Akamai differently than curl.
// Vestiaire blocks node, allows curl. We shell out.
function curlGet(url, outPath, isImage = false) {
  const headers = isImage
    ? `-H "Accept: image/avif,image/webp,image/*,*/*"`
    : `-H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"`;
  const cmd = [
    'curl', '-skL',
    '-w', '"%{http_code}"',
    '-o', `"${outPath}"`,
    `-H "User-Agent: ${HEADERS['User-Agent']}"`,
    headers,
    `-H "Accept-Language: en-US,en;q=0.9"`,
    '--compressed',
    `"${url}"`,
  ].join(' ');
  const code = execSync(cmd, { encoding: 'utf8' }).trim().replace(/"/g, '');
  if (!code.startsWith('2')) throw new Error(`HTTP ${code}`);
}

async function fetchHtml(url) {
  const tmp = `${tmpdir()}/vc-${randomBytes(4).toString('hex')}.html`;
  curlGet(url, tmp, false);
  const html = readFileSync(tmp, 'utf8');
  try { unlinkSync(tmp); } catch {}
  return html;
}

async function downloadImage(url, outPath) {
  curlGet(url, outPath, true);
  const buf = readFileSync(outPath);
  return buf.length;
}

async function processOne(url, idx) {
  console.log(`\n[${idx + 1}] ${url}`);
  const html = await fetchHtml(url);
  console.log(`  HTML: ${html.length} bytes`);

  const jsonLd = pickJsonLdProduct(html);
  const ogTitle = pickMeta(html, 'og:title') ?? '';
  const ogDesc  = pickMeta(html, 'og:description') ?? '';
  const ogImg   = pickMeta(html, 'og:image') ?? '';

  const brand = jsonLd?.brand?.name ?? jsonLd?.brand ?? 'Unknown';
  const sgdPrice = pickPrice(html);
  const currency = pickCurrency(html);

  // Convert to EUR if SGD; otherwise pass-through
  let priceEur;
  if (currency === 'EUR') priceEur = sgdPrice;
  else if (currency === 'SGD') priceEur = Math.round(sgdPrice * SGD_TO_EUR);
  else priceEur = sgdPrice; // best-effort

  const description = jsonLd?.description ?? ogDesc ?? '';
  const condition = (jsonLd?.itemCondition ?? '').replace(/^https?:\/\/schema\.org\//, '') || 'Used';

  const sku = jsonLd?.sku ?? url.match(/-(\d+)\.shtml/)?.[1];
  const slug = `${(typeof brand === 'string' ? brand : brand.name ?? 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${sku}`;

  const imageUrls = imagesFromJsonLdProduct(jsonLd, html);

  // Download images locally
  const itemDir = `${IMG_DIR}/${slug}`;
  if (!existsSync(itemDir)) mkdirSync(itemDir, { recursive: true });

  const localImages = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const fname = `img-${i + 1}.jpg`;
    const outPath = `${itemDir}/${fname}`;
    try {
      const size = await downloadImage(imageUrls[i], outPath);
      console.log(`  ✓ image ${i + 1}: ${imageUrls[i].slice(-80)} → ${fname} (${(size / 1024).toFixed(0)}kb)`);
      localImages.push(`${slug}/${fname}`);
    } catch (e) {
      console.log(`  ✗ image ${i + 1} failed: ${e.message}`);
      // First image is essential — the rest are slot-guesses that may 404
      if (i === 0) throw e;
      break; // stop trying further numbered slots once one 404s
    }
  }

  const cleanTitle = parseTitle(ogTitle, brand);
  const size = parseSize(ogTitle);

  const entry = {
    source_url: url,
    brand: typeof brand === 'string' ? brand : (brand.name ?? 'Unknown'),
    name: cleanTitle,
    category: categoryFromUrl(url),
    price_eur: priceEur,
    price_currency_source: currency,
    condition,
    size,
    original_description: description.replace(/\s+/g, ' ').trim(),
    images: localImages,
  };

  console.log(`  → ${entry.brand} | ${entry.category} | €${entry.price_eur} | size ${entry.size}`);
  return entry;
}

(async () => {
  if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

  const entries = [];
  for (let i = 0; i < URLS.length; i++) {
    try {
      const e = await processOne(URLS[i], i);
      entries.push(e);
    } catch (e) {
      console.error(`  FAIL: ${e.message}`);
    }
  }

  writeFileSync(OUT_JSON, JSON.stringify(entries, null, 2));
  console.log(`\n──── Wrote ${entries.length} entries → ${OUT_JSON} ────`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
