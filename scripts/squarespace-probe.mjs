/**
 * scripts/squarespace-probe.mjs
 *
 * Dry-run probe: fetch a Squarespace shop, normalize to ShopifyProduct shape,
 * print a summary. No DB writes, no on-chain calls.
 *
 * Usage:
 *   node scripts/squarespace-probe.mjs https://www.passportadv.com/shop-1
 *   node scripts/squarespace-probe.mjs https://www.passportadv.com/shop-1 --verbose
 */

const SHOP_URL = process.argv[2];
const VERBOSE  = process.argv.includes('--verbose');

if (!SHOP_URL) {
  console.error('Usage: node scripts/squarespace-probe.mjs <shop-url> [--verbose]');
  process.exit(1);
}

function parseShopUrl(u) {
  const url = new URL(u);
  return { origin: url.origin, path: url.pathname.replace(/\/$/, '') };
}

async function fetchPage(shopUrl, offset) {
  const { origin, path } = parseShopUrl(shopUrl);
  const sep = path.includes('?') ? '&' : '?';
  const offsetPart = offset ? `&offset=${offset}` : '';
  const url = `${origin}${path}${sep}format=json${offsetPart}`;
  console.log(`[sqs] GET ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RRG-Mirror/2.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Squarespace ${res.status}`);
  return res.json();
}

function normalize(item) {
  const sqsVariants = item.structuredContent?.variants ?? [];
  const variants = sqsVariants.map((v, idx) => {
    const attrLabel = v.attributes ? Object.values(v.attributes).join(' / ') : 'Default';
    return {
      title:   attrLabel || 'Default',
      price:   (v.price / 100).toFixed(2),
      sku:     v.sku,
      available: v.unlimited || v.qtyInStock > 0,
      position:  idx + 1,
    };
  });
  if (variants.length === 0) {
    variants.push({ title: 'Default', price: '0.00', sku: null, available: true, position: 1 });
  }
  const imageList = (item.items ?? []).filter(i => i.assetUrl);
  const images = imageList.length
    ? imageList.sort((a, b) => a.displayIndex - b.displayIndex).map((img, idx) => ({ src: img.assetUrl, position: idx + 1 }))
    : item.assetUrl ? [{ src: item.assetUrl, position: 1 }] : [];
  return {
    title:    item.title,
    handle:   item.urlId,
    url:      item.fullUrl,
    body_html: item.body ?? item.excerpt ?? null,
    variants,
    images,
  };
}

(async () => {
  const all = [];
  let offset;
  for (let page = 0; page < 20; page++) {
    const data = await fetchPage(SHOP_URL, offset);
    const items = (data.items ?? []).map(normalize);
    all.push(...items);
    if (!data.pagination?.nextPage || !data.pagination?.nextPageOffset) break;
    offset = data.pagination.nextPageOffset;
  }

  console.log(`\n=== ${all.length} products ===\n`);
  for (const p of all) {
    const priceRange = (() => {
      const prices = p.variants.map(v => parseFloat(v.price)).filter(Number.isFinite).filter(n => n > 0);
      if (!prices.length) return '$?';
      const min = Math.min(...prices), max = Math.max(...prices);
      return min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)}-${max.toFixed(2)}`;
    })();
    const avail = p.variants.filter(v => v.available).length;
    console.log(`- ${p.title}`);
    console.log(`    handle:    ${p.handle}`);
    console.log(`    url:       ${p.url}`);
    console.log(`    price:     ${priceRange}   (${avail}/${p.variants.length} variants available)`);
    console.log(`    images:    ${p.images.length}`);
    if (VERBOSE) {
      console.log(`    variants:  ${p.variants.map(v => `${v.title}=${v.price}${v.available?'':' [OOS]'}`).join(', ')}`);
      if (p.images[0]) console.log(`    img[0]:    ${p.images[0].src}`);
    }
    console.log('');
  }

  const totalVariants = all.reduce((s, p) => s + p.variants.length, 0);
  const totalImages   = all.reduce((s, p) => s + p.images.length, 0);
  const withImages    = all.filter(p => p.images.length > 0).length;
  console.log(`=== summary ===`);
  console.log(`products:       ${all.length}`);
  console.log(`variants total: ${totalVariants}`);
  console.log(`images total:   ${totalImages}  (${withImages}/${all.length} products have ≥1 image)`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
