/**
 * scripts/backfill-clooudie-variant-gids.mjs
 *
 * Fill in rrg_submissions.shopify_variant_gid for every Clooudie drop by
 * matching each DB row's `ecommerce_url` (or title) back to a Shopify
 * product handle, then calling Storefront API to fetch the first variant GID.
 *
 * One-shot. Re-run is safe (skips rows already backfilled).
 *
 * Usage:
 *   node scripts/backfill-clooudie-variant-gids.mjs
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   SHOPIFY_CLOOUDIE_STOREFRONT_TOKEN, SHOPIFY_CLOOUDIE_DOMAIN
 *   SHOPIFY_API_VERSION (optional, default 2025-10)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {
  console.error('FATAL: could not read .env.local');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TOKEN        = process.env.SHOPIFY_CLOOUDIE_STOREFRONT_TOKEN;
const DOMAIN       = process.env.SHOPIFY_CLOOUDIE_DOMAIN || 'clooudie.myshopify.com';
const API_VERSION  = process.env.SHOPIFY_API_VERSION || '2025-10';

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, TOKEN })) {
  if (!v) { console.error(`FATAL: ${k} not set`); process.exit(1); }
}

const BRAND_SLUG = 'clooudie';
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function gql(query, variables) {
  const r = await fetch(`https://${DOMAIN}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Storefront-Access-Token': TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'RRG-Backfill/1.0' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Shopify ${r.status}`);
  const body = await r.json();
  if (body.errors) throw new Error('GraphQL: ' + JSON.stringify(body.errors));
  return body.data;
}

function handleFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : null;
}

async function fetchFirstVariantGid(handle) {
  const q = `query($handle: String!) { productByHandle(handle: $handle) { variants(first: 1) { edges { node { id } } } } }`;
  const d = await gql(q, { handle });
  return d.productByHandle?.variants?.edges?.[0]?.node?.id ?? null;
}

(async () => {
  // Find the brand
  const { data: brand, error: bErr } = await db
    .from('rrg_brands').select('id').eq('slug', BRAND_SLUG).maybeSingle();
  if (bErr || !brand) { console.error('Brand not found'); process.exit(1); }

  // Find drops for this brand that still need a GID
  const { data: rows, error } = await db
    .from('rrg_submissions')
    .select('id, token_id, title, ecommerce_url, shopify_variant_gid')
    .eq('brand_id', brand.id)
    .eq('is_brand_product', true)
    .order('token_id', { ascending: true });
  if (error) { console.error(error); process.exit(1); }

  console.log(`Found ${rows.length} Clooudie drops`);
  let updated = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    if (r.shopify_variant_gid) {
      console.log(`  skip #${r.token_id} "${r.title}" — already has GID`);
      skipped++;
      continue;
    }
    const handle = handleFromUrl(r.ecommerce_url);
    if (!handle) {
      console.warn(`  FAIL #${r.token_id} "${r.title}" — no handle from url ${r.ecommerce_url}`);
      failed++;
      continue;
    }
    try {
      const gid = await fetchFirstVariantGid(handle);
      if (!gid) {
        console.warn(`  FAIL #${r.token_id} "${r.title}" — no variant for handle ${handle}`);
        failed++;
        continue;
      }
      const { error: uErr } = await db
        .from('rrg_submissions')
        .update({ shopify_variant_gid: gid })
        .eq('id', r.id);
      if (uErr) { console.error(`  FAIL #${r.token_id}:`, uErr.message); failed++; continue; }
      console.log(`  ok  #${r.token_id} "${r.title}" → ${gid}`);
      updated++;
    } catch (e) {
      console.warn(`  FAIL #${r.token_id}:`, e.message);
      failed++;
    }
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}, failed=${failed}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
