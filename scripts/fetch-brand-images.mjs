/**
 * scripts/fetch-brand-images.mjs
 *
 *   node scripts/fetch-brand-images.mjs --slug <slug> --host <host>
 *
 * Scrapes logo + banner candidates from <host>'s homepage, picks best,
 * crops with sharp (logo → 512² PNG, banner → 1600×640 JPEG), uploads to
 * supabase storage at brands/{sellerId}/logo.png + banner.jpeg using the
 * service role key, and updates app_sellers.logo_path / banner_path.
 *
 * End state is identical to PATCH /api/rrg/admin/brands/[sellerId] with
 * multipart, just without the admin-cookie hop.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i>=0 ? args[i+1] : null; };
const SLUG = flag('--slug');
const HOST = flag('--host');
const DRY  = args.includes('--dry-run');
if (!SLUG || !HOST) { console.error('Usage: --slug <slug> --host <host>'); process.exit(1); }

const env = readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{
  const m=l.match(/^([A-Z_]+)=(.*)$/); if(m) a[m[1]]=m[2].replace(/^["']|["']$/g,''); return a;
},{});
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const UA = 'Mozilla/5.0 (compatible; RRG-Onboarder/1.0; +https://realrealgenuine.com)';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r.text();
}
async function fetchBuf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
function absUrl(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}
// Strip Shopify CDN size constraints so we get the source-resolution asset.
function stripShopifySize(url) {
  if (!url) return url;
  // Liquid placeholder leak: some shops embed {width}x in CDN URLs (raw or URL-encoded);
  // substitute a real width so the CDN serves something instead of 404.
  url = url
    .replace(/\{width\}/g, '1600').replace(/\{height\}/g, '')
    .replace(/%7Bwidth%7D/gi, '1600').replace(/%7Bheight%7D/gi, '');
  try {
    const u = new URL(url);
    const isShopifyCdn = /cdn\.shop(ify)?\.com/.test(u.host) || /\/cdn\/shop\//.test(u.pathname);
    if (isShopifyCdn) {
      for (const k of ['width','height','crop']) u.searchParams.delete(k);
      u.pathname = u.pathname.replace(/_\d+x(\d+)?\./, '.');
    }
    return u.href;
  } catch { return url; }
}

(async () => {
  console.log(`──── fetch-brand-images: ${SLUG} (${HOST}) ────`);

  // Look up brand id
  const { data: brand, error: be } = await db.from('app_sellers').select('id,slug,name').eq('slug', SLUG).single();
  if (be || !brand) throw new Error(`No brand row for slug=${SLUG}: ${be?.message || 'not found'}`);
  console.log(`brand_id: ${brand.id}`);

  const base = `https://${HOST}/`;
  const html = await fetchText(base);

  // --- Candidate logos ---
  const logoCandidates = [];
  // apple-touch-icon
  for (const m of html.matchAll(/<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/gi)) {
    const tag = m[0];
    const href = (tag.match(/href=["']([^"']+)["']/i)||[])[1];
    const sizesM = tag.match(/sizes=["']([^"']+)["']/i);
    const sizes = sizesM ? parseInt(sizesM[1].split('x')[0],10)||0 : 0;
    if (href) logoCandidates.push({ url: absUrl(href, base), kind: 'apple-touch-icon', score: 1000 + sizes });
  }
  // icon
  for (const m of html.matchAll(/<link[^>]+rel=["']icon["'][^>]*>/gi)) {
    const tag = m[0];
    const href = (tag.match(/href=["']([^"']+)["']/i)||[])[1];
    const sizesM = tag.match(/sizes=["']([^"']+)["']/i);
    const sizes = sizesM ? parseInt(sizesM[1].split('x')[0],10)||0 : 0;
    const type = (tag.match(/type=["']([^"']+)["']/i)||[])[1] || '';
    const isSvg = /svg/i.test(type) || /\.svg/i.test(href||'');
    if (href) logoCandidates.push({ url: absUrl(href, base), kind: 'icon'+(isSvg?'-svg':''), score: (isSvg?2500:500) + sizes });
  }
  // msapplication-TileImage
  for (const m of html.matchAll(/<meta[^>]+name=["']msapplication-TileImage["'][^>]+content=["']([^"']+)["']/gi)) {
    logoCandidates.push({ url: absUrl(m[1], base), kind: 'tile', score: 400 });
  }
  // og:logo (rare)
  for (const m of html.matchAll(/<meta[^>]+property=["']og:logo["'][^>]+content=["']([^"']+)["']/gi)) {
    logoCandidates.push({ url: absUrl(m[1], base), kind: 'og:logo', score: 1500 });
  }
  // Shopify storefront image often: header img with alt matching shop name
  // (fall-through)
  logoCandidates.push({ url: absUrl('/favicon.ico', base), kind: 'favicon-fallback', score: 100 });

  // --- Candidate banners ---
  const bannerCandidates = [];
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) {
    bannerCandidates.push({ url: absUrl(m[1], base), kind: 'og:image', score: 1000 });
  }
  for (const m of html.matchAll(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi)) {
    bannerCandidates.push({ url: absUrl(m[1], base), kind: 'twitter:image', score: 800 });
  }
  // First large hero img on homepage — pick a Shopify CDN image with "files" path
  // Matches both cdn.shopify.com and shop-on-custom-domain (/cdn/shop/) URLs.
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+(?:cdn\.shop|cdn\/shop)[^"']+)["'][^>]*>/gi)) {
    const url = absUrl(m[1], base);
    if (url && !/logo|icon|favicon/i.test(url)) {
      bannerCandidates.push({ url, kind: 'cdn-hero', score: 400 });
      if (bannerCandidates.filter(c=>c.kind==='cdn-hero').length >= 5) break;
    }
  }

  console.log('Logo candidates:');
  logoCandidates.sort((a,b)=>b.score-a.score).forEach(c=>console.log(' ',c.score, c.kind, c.url));
  console.log('Banner candidates:');
  bannerCandidates.sort((a,b)=>b.score-a.score).forEach(c=>console.log(' ',c.score, c.kind, c.url));

  // Try logos top-down until one works at usable size
  const tmpDir = resolve(process.cwd(), 'tmp', SLUG);
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  // Also consider og:image as a logo fallback (some shops use a logo crop there)
  for (const c of bannerCandidates) {
    if (c.kind === 'og:image' && c.url) {
      logoCandidates.push({ url: c.url, kind: 'og:image-as-logo', score: 200 });
    }
  }
  // Apply Shopify size strip to all logo candidates
  for (const c of logoCandidates) c.url = stripShopifySize(c.url);
  // Re-sort
  logoCandidates.sort((a,b)=>b.score-a.score);

  let logoOut = null;
  for (const c of logoCandidates) {
    if (!c.url) continue;
    try {
      const buf = await fetchBuf(c.url);
      // For SVG/ICO, sharp may not handle natively; try and fall through
      let img;
      try { img = sharp(buf, { density: 300 }); } catch (e) { console.log('  sharp open fail', c.kind, e.message); continue; }
      const meta = await img.metadata();
      if (!meta.width || meta.width < 48) { console.log('  skip', c.kind, 'too small', meta.width); continue; }
      // Pad to square if rectangular (transparent), then resize 512
      const size = Math.max(meta.width, meta.height);
      const padded = await img
        .resize({ width: size, height: size, fit: 'contain', background: { r:255, g:255, b:255, alpha: 0 } })
        .png()
        .toBuffer();
      const final = await sharp(padded).resize(512, 512, { fit: 'contain', background: { r:255, g:255, b:255, alpha: 0 } }).png().toBuffer();
      writeFileSync(resolve(tmpDir, 'logo.png'), final);
      logoOut = { buffer: final, ext: 'png', mime: 'image/png', kind: c.kind, src: c.url, meta };
      console.log(`Logo: chose ${c.kind} ${meta.width}x${meta.height} from ${c.url}`);
      break;
    } catch (e) { console.log('  fail', c.kind, e.message); }
  }
  if (!logoOut) console.warn('!! no logo selected');

  // Strip Shopify size constraints from banner candidates too
  for (const c of bannerCandidates) c.url = stripShopifySize(c.url);
  bannerCandidates.sort((a,b)=>b.score-a.score);

  let bannerOut = null;
  for (const c of bannerCandidates) {
    if (!c.url) continue;
    try {
      const buf = await fetchBuf(c.url);
      const img = sharp(buf);
      const meta = await img.metadata();
      if (!meta.width || meta.width < 800) { console.log('  skip banner', c.kind, meta.width); continue; }
      // Crop to 1600×640 (2.5:1), center
      const target = { w: 1600, h: 640 };
      const srcAR = meta.width/meta.height;
      const tgtAR = target.w/target.h;
      let cropW, cropH, left, top;
      if (srcAR > tgtAR) {
        cropH = meta.height; cropW = Math.round(meta.height * tgtAR);
        left = Math.round((meta.width - cropW)/2); top = 0;
      } else {
        cropW = meta.width; cropH = Math.round(meta.width / tgtAR);
        left = 0; top = Math.round((meta.height - cropH)/2);
      }
      const final = await img.extract({ left, top, width: cropW, height: cropH }).resize(target.w, target.h).jpeg({ quality: 86 }).toBuffer();
      writeFileSync(resolve(tmpDir, 'banner.jpeg'), final);
      bannerOut = { buffer: final, ext: 'jpeg', mime: 'image/jpeg', kind: c.kind, src: c.url, meta };
      console.log(`Banner: chose ${c.kind} ${meta.width}x${meta.height} from ${c.url}`);
      break;
    } catch (e) { console.log('  fail banner', c.kind, e.message); }
  }
  if (!bannerOut) console.warn('!! no banner selected');

  if (DRY) { console.log('[dry-run] not uploading'); return; }

  const updates = {};
  if (logoOut) {
    const path = `brands/${brand.id}/logo.${logoOut.ext}`;
    const { error } = await db.storage.from('rrg-submissions').upload(path, logoOut.buffer, { contentType: logoOut.mime, upsert: true });
    if (error) throw new Error('logo upload: '+error.message);
    updates.logo_path = path;
    console.log('Uploaded logo  →', path);
  }
  if (bannerOut) {
    const path = `brands/${brand.id}/banner.${bannerOut.ext}`;
    const { error } = await db.storage.from('rrg-submissions').upload(path, bannerOut.buffer, { contentType: bannerOut.mime, upsert: true });
    if (error) throw new Error('banner upload: '+error.message);
    updates.banner_path = path;
    console.log('Uploaded banner→', path);
  }
  if (Object.keys(updates).length) {
    const { error } = await db.from('app_sellers').update(updates).eq('id', brand.id);
    if (error) throw new Error('db update: '+error.message);
    console.log('app_sellers updated:', Object.keys(updates).join(','));
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
