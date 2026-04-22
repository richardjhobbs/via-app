/**
 * scripts/test-shipping-quote.mjs
 *
 * Standalone test: exercise the Shopify Admin draft-order rate flow for UU.
 * Picks a real UU variant + a US destination, prints the rates Shopify
 * would return during checkout. No MCP, no Next.js — just verifying the
 * Admin API integration works end-to-end before wiring it into the app.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) {
    process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Fetch UU brand row
const brandRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rrg_brands?slug=eq.unknown-union&select=shopify_domain,shopify_storefront_token_encrypted`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
);
const [brand] = await brandRes.json();
const token = brand.shopify_storefront_token_encrypted.startsWith('plaintext:')
  ? brand.shopify_storefront_token_encrypted.slice('plaintext:'.length)
  : null;
if (!token) { console.error('no token'); process.exit(1); }

// Pick a known in-stock variant. Seven Society Skirt token #63 has sizes
// S/M/L/XL. Query its shopify_variant_id for size M.
const varRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rrg_product_variants?submission_id=eq.(select id from rrg_submissions where token_id = 63)&size=eq.M&select=shopify_variant_id&limit=1`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
);
// That query doesn't work via PostgREST — do it in two steps.
const subRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rrg_submissions?token_id=eq.63&select=id`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
);
const [sub] = await subRes.json();
const variantRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rrg_product_variants?submission_id=eq.${sub.id}&size=eq.M&select=shopify_variant_id&limit=1`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
);
const [variant] = await variantRes.json();
const variantId = variant.shopify_variant_id;
console.log(`Testing with variant_id=${variantId} (Seven Society Skirt, size M)`);
console.log(`Token prefix: ${token.slice(0, 7)}…`);
console.log(`Domain: ${brand.shopify_domain}`);
console.log();

// ── Direct Admin API draft-order rate test ────────────────────────────

const canonical = brand.shopify_domain.endsWith('.myshopify.com')
  ? brand.shopify_domain
  : 'unknown-union-shop.myshopify.com';

async function admin(method, path, body) {
  const res = await fetch(`https://${canonical}/admin/api/2024-10${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

console.log('Creating draft order…');
const draftPayload = {
  draft_order: {
    line_items: [{ variant_id: variantId, quantity: 1 }],
    shipping_address: {
      first_name: 'RRG',
      last_name:  'Test',
      address1:   '1600 Pennsylvania Ave NW',
      city:       'Washington',
      province:   'District of Columbia',
      country:    'United States',
      country_code: 'US',
      zip:        '20500',
    },
    tags: 'rrg-shipping-quote-test',
  },
};
const draft = await admin('POST', '/draft_orders.json', draftPayload);
const draftId = draft.draft_order.id;
console.log(`  draft_id=${draftId}`);

console.log('Fetching shipping rates…');
const rates = await admin('GET', `/draft_orders/${draftId}/shipping_rates.json`);
console.log(`  ${rates.shipping_rates.length} rate(s) returned:`);
for (const r of rates.shipping_rates) {
  console.log(`    - ${r.title.padEnd(40)} $${r.price}  [${r.handle}]`);
}

console.log('Cleaning up draft…');
await admin('DELETE', `/draft_orders/${draftId}.json`);
console.log('  done.');
