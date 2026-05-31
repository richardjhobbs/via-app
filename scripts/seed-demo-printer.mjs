/**
 * scripts/seed-demo-printer.mjs
 *
 * Seeds ONE configurable seller — a custom-apparel printer modelled on
 * directtshirt.com — as the reference case for agent-to-agent negotiation.
 * The apparel vertical is only example data: the option_schema written here
 * is the generic OfferingSchema shape consumed by lib/app/quote-pricing.ts,
 * and the same structure represents custom furniture, catering, freight, or
 * tiered software equally well.
 *
 * What it creates:
 *   - app_sellers row  slug='demo-printer' (kind 'mixed')
 *   - app_seller_products row, pricing_mode='configurable', carrying the
 *     full option_schema (garment x print method x locations x sizes x
 *     quantity tiers x rush). price_minor is a non-binding "from" anchor.
 *
 * owner_user_id is NOT NULL (FK to auth.users). Rather than mint a user, the
 * script reuses the owner of an existing seller so that person can sign into
 * /seller/demo-printer/admin/quotes and approve quotes. If no seller exists
 * yet, it aborts with guidance instead of guessing a user id.
 *
 * Idempotent: re-running upserts the seller by slug and the product by
 * (seller_id, title).
 *
 * Usage:
 *   node scripts/seed-demo-printer.mjs
 *   node scripts/seed-demo-printer.mjs --owner <auth-user-uuid>   # pin owner explicitly
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local ──────────────────────────────────────────────────
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
  console.error('FATAL: could not read .env.local'); process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: Supabase env missing'); process.exit(1); }

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const ownerFlag = (() => { const i = args.indexOf('--owner'); return i >= 0 ? args[i + 1] : null; })();

const SLUG = 'demo-printer';

// ── The offering schema (generic CPQ shape; apparel is just the data) ──
// Money is major USDC units, matching lib/app/quote-pricing.ts. No MOQ:
// quantity.min = 1 is the directtshirt.com differentiator.
const OPTION_SCHEMA = {
  currency:   'USDC',
  base_price: 4.0, // blank standard tee, one print location amortised below
  groups: [
    {
      key: 'garment', label: 'Garment', type: 'single_select', required: true,
      choices: [
        { key: 'standard_tee', label: 'Standard cotton tee',      price_delta: 0 },
        { key: 'premium_tee',  label: 'Premium ringspun tee',     price_delta: 3 },
        { key: 'polo',         label: 'Pique polo',               price_delta: 8 },
        { key: 'heavy_hoodie', label: 'Heavyweight pullover hoodie', price_delta: 14 },
        { key: 'zip_hoodie',   label: 'Full-zip hoodie',          price_delta: 18 },
        { key: 'tote',         label: 'Canvas tote bag',          price_delta: 2 },
      ],
    },
    {
      key: 'print_method', label: 'Print method', type: 'single_select', required: true,
      choices: [
        { key: 'screen_print', label: 'Screen print',          price_delta: 2 },
        { key: 'dtg',          label: 'Direct-to-garment',      price_delta: 3 },
        { key: 'dtf',          label: 'Direct-to-film transfer', price_delta: 3.5 },
        { key: 'vinyl_htv',    label: 'Heat-transfer vinyl',    price_delta: 4 },
        { key: 'embroidery',   label: 'Embroidery',             price_delta: 6 },
      ],
    },
    {
      key: 'print_locations', label: 'Print locations', type: 'multi_select',
      included_count: 1, // first location included in base; extras priced
      choices: [
        { key: 'front',       label: 'Front',        price_delta: 3 },
        { key: 'back',        label: 'Back',         price_delta: 3 },
        { key: 'left_chest',  label: 'Left chest',   price_delta: 2.5 },
        { key: 'left_sleeve', label: 'Left sleeve',  price_delta: 2 },
        { key: 'right_sleeve',label: 'Right sleeve', price_delta: 2 },
        { key: 'nape',        label: 'Inner nape label', price_delta: 2 },
      ],
    },
    {
      key: 'size', label: 'Size band', type: 'single_select', required: false,
      choices: [
        { key: 'std', label: 'XS-XL',  price_delta: 0 },
        { key: 'xxl', label: '2XL',    price_delta: 2 },
        { key: 'xxxl', label: '3XL+',  price_delta: 3 },
      ],
    },
    {
      key: 'ink_colors', label: 'Screen-print ink colours', type: 'numeric',
      price_per_unit: 0.5, min: 1, max: 8,
    },
    {
      key: 'rush', label: 'Rush production', type: 'boolean', required: false,
    },
  ],
  quantity: {
    min: 1, // no minimum order quantity
    tiers: [
      { min_qty: 12,  unit_multiplier: 0.9 },
      { min_qty: 50,  unit_multiplier: 0.8 },
      { min_qty: 100, unit_multiplier: 0.7 },
      { min_qty: 250, unit_multiplier: 0.6 },
    ],
  },
  modifiers: [
    { key: 'rush', label: 'Rush production', type: 'pct', amount: 30 },
  ],
};

const SELLER = {
  slug:          SLUG,
  name:          'Inkside Press',
  kind:          'mixed',
  contact_email: 'studio@inksidepress.example',
  website_url:   'https://www.directtshirt.com/',
  headline:      'Custom apparel, printed to spec. No minimums.',
  description:   'A custom-print studio. Configure garment, method, placement and quantity; a Sales Agent quotes from our own pricing rule, and we approve before anything is binding.',
  wallet_address:'0x0000000000000000000000000000000000000000',
  active:        true,
};

const PRODUCT = {
  kind:         'physical',
  title:        'Custom printed apparel',
  description:  'Configurable custom-print order: choose garment, print method, placement, size band and quantity. Price is computed from the studio pricing rule and confirmed by a human before it binds.',
  price_minor:  7_000_000, // 7.00 USDC "from" anchor; real total comes from the quote
  currency:     'USDC',
  stock:        null,
  active:       true,
  pricing_mode: 'configurable',
  option_schema: OPTION_SCHEMA,
};

async function resolveOwner() {
  if (ownerFlag) return ownerFlag;
  const { data, error } = await db
    .from('app_sellers')
    .select('owner_user_id, slug')
    .neq('slug', SLUG)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`owner lookup: ${error.message}`);
  if (!data?.owner_user_id) {
    console.error('FATAL: no existing seller to borrow an owner_user_id from.');
    console.error('Create a seller first, or pass --owner <auth-user-uuid>.');
    process.exit(1);
  }
  console.log(`[seed] reusing owner_user_id from seller "${data.slug}"`);
  return data.owner_user_id;
}

(async () => {
  console.log('──── Seed demo printer (configurable negotiation reference) ────');

  const ownerId = await resolveOwner();

  // Upsert seller by slug
  const { data: existing } = await db
    .from('app_sellers').select('id').eq('slug', SLUG).maybeSingle();

  let sellerId;
  if (existing) {
    const { error } = await db.from('app_sellers')
      .update({ ...SELLER, owner_user_id: ownerId, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw new Error(`seller update: ${error.message}`);
    sellerId = existing.id;
    console.log(`[seed] updated seller id=${sellerId}`);
  } else {
    const { data, error } = await db.from('app_sellers')
      .insert({ ...SELLER, owner_user_id: ownerId })
      .select('id').single();
    if (error) throw new Error(`seller insert: ${error.message}`);
    sellerId = data.id;
    console.log(`[seed] created seller id=${sellerId}`);
  }

  // Upsert product by (seller_id, title)
  const { data: prodExisting } = await db
    .from('app_seller_products')
    .select('id').eq('seller_id', sellerId).eq('title', PRODUCT.title).maybeSingle();

  let productId;
  if (prodExisting) {
    const { error } = await db.from('app_seller_products')
      .update({ ...PRODUCT, updated_at: new Date().toISOString() })
      .eq('id', prodExisting.id);
    if (error) throw new Error(`product update: ${error.message}`);
    productId = prodExisting.id;
    console.log(`[seed] updated product id=${productId}`);
  } else {
    const { data, error } = await db.from('app_seller_products')
      .insert({ ...PRODUCT, seller_id: sellerId })
      .select('id').single();
    if (error) throw new Error(`product insert: ${error.message}`);
    productId = data.id;
    console.log(`[seed] created product id=${productId}`);
  }

  console.log('──── Done ────');
  console.log(`Seller:   ${SELLER.name}  (/sellers/${SLUG})`);
  console.log(`MCP:      /sellers/${SLUG}/mcp`);
  console.log(`Admin:    /seller/${SLUG}/admin/quotes`);
  console.log(`Product:  ${productId}  (pricing_mode=configurable)`);
  console.log('\nNext: call get_offering_schema then request_quote against the MCP endpoint.');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
