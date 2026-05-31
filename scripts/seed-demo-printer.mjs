/**
 * scripts/seed-demo-printer.mjs
 *
 * Seeds ONE configurable seller, Inkside Press (slug 'demo-printer'), a custom
 * apparel studio modelled on directtshirt.com, as the reference case for
 * agent-to-agent negotiation. Apparel is only example data: the option_schema
 * written here is the generic OfferingSchema shape consumed by
 * lib/app/quote-pricing.ts, and the same structure represents custom furniture,
 * catering, freight or tiered software equally well.
 *
 * What it creates:
 *   - app_sellers row  slug='demo-printer' (kind 'mixed')
 *   - 4 app_seller_products rows, pricing_mode='configurable', each carrying a
 *     full option_schema (garment x method x locations x add-ons x quantity
 *     tiers x rush). price_minor is a non-binding "from" anchor.
 *
 * Discoverability: each product is written with on_chain_status='registered'
 * and active=true, because the per-seller MCP list_products tool only returns
 * products that are BOTH registered and active. A configurable product left at
 * the default on_chain_status='draft' can still be quoted if its id is known,
 * but a buying agent cannot discover it. Registered + active is required for a
 * full discover -> schema -> quote round trip.
 *
 * owner_user_id is NOT NULL (FK to auth.users). Rather than mint a user, the
 * script reuses the owner of an existing seller so that person can sign into
 * /seller/demo-printer/admin/quotes and approve quotes. If no seller exists
 * yet, it aborts with guidance instead of guessing a user id.
 *
 * Idempotent: re-running upserts the seller by slug and each product by
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
  console.error('FATAL: could not read .env.local'); process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: Supabase env missing'); process.exit(1); }

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const ownerFlag = (() => { const i = args.indexOf('--owner'); return i >= 0 ? args[i + 1] : null; })();

const SLUG = 'demo-printer';

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

// ── The catalog: 4 configurable products, all registered + active ──────
// Money is major USDC units, matching lib/app/quote-pricing.ts. Every schema
// carries: a required single_select garment, a multi_select location group
// with included_count=1, a numeric add-on, a `rush` boolean group with a
// matching pct modifier, and quantity tiers starting from min=1 (no MOQ).
// Labels avoid apostrophes and dashes (em/en) per the user-facing copy rule.
const PRODUCTS = [
  {
    kind: 'physical',
    title: 'Custom tote bag',
    description: 'Printed cotton and canvas totes for events and merch runs. No minimum, deep volume tiers. Quote from the studio rule, human approved before binding.',
    price_minor: 5_000_000,
    currency: 'USDC',
    stock: null,
    active: true,
    pricing_mode: 'configurable',
    on_chain_status: 'registered',
    option_schema: {
      currency: 'USDC',
      base_price: 3.5,
      groups: [
        {
          key: 'fabric', label: 'Fabric', type: 'single_select', required: true,
          choices: [
            { key: 'cotton_5oz',  label: '5oz cotton',     price_delta: 0 },
            { key: 'canvas_10oz', label: '10oz canvas',    price_delta: 2 },
            { key: 'recycled',    label: 'Recycled blend', price_delta: 1.5 },
          ],
        },
        {
          key: 'print_method', label: 'Print method', type: 'single_select', required: true,
          choices: [
            { key: 'screen_print', label: 'Screen print',        price_delta: 1.5 },
            { key: 'dtg',          label: 'Direct to garment',   price_delta: 2.5 },
            { key: 'vinyl_htv',    label: 'Heat transfer vinyl', price_delta: 3 },
          ],
        },
        {
          key: 'print_locations', label: 'Print locations', type: 'multi_select', included_count: 1,
          choices: [
            { key: 'front', label: 'Front', price_delta: 2 },
            { key: 'back',  label: 'Back',  price_delta: 2 },
          ],
        },
        { key: 'ink_colors', label: 'Ink colours', type: 'numeric', price_per_unit: 0.4, min: 1, max: 6 },
        { key: 'rush', label: 'Rush production', type: 'boolean', required: false },
      ],
      quantity: {
        min: 1,
        tiers: [
          { min_qty: 25,  unit_multiplier: 0.9 },
          { min_qty: 100, unit_multiplier: 0.8 },
          { min_qty: 500, unit_multiplier: 0.65 },
        ],
      },
      modifiers: [{ key: 'rush', label: 'Rush production', type: 'pct', amount: 25 }],
    },
  },
  {
    kind: 'physical',
    title: 'Custom printed t-shirt',
    description: 'Made to order screen, DTG, DTF or vinyl printed tees. No minimum. Configure garment, method, placement, ink count and quantity; a Sales Agent quotes from the studio rule and a human approves before it binds.',
    price_minor: 6_000_000,
    currency: 'USDC',
    stock: null,
    active: true,
    pricing_mode: 'configurable',
    on_chain_status: 'registered',
    option_schema: {
      currency: 'USDC',
      base_price: 4,
      groups: [
        {
          key: 'garment', label: 'Garment', type: 'single_select', required: true,
          choices: [
            { key: 'standard_tee', label: 'Standard cotton tee',  price_delta: 0 },
            { key: 'premium_tee',  label: 'Premium ringspun tee', price_delta: 3 },
            { key: 'tri_blend',    label: 'Tri-blend tee',        price_delta: 4 },
          ],
        },
        {
          key: 'print_method', label: 'Print method', type: 'single_select', required: true,
          choices: [
            { key: 'screen_print', label: 'Screen print',           price_delta: 2 },
            { key: 'dtg',          label: 'Direct to garment',      price_delta: 3 },
            { key: 'dtf',          label: 'Direct to film transfer', price_delta: 3.5 },
            { key: 'vinyl_htv',    label: 'Heat transfer vinyl',    price_delta: 4 },
          ],
        },
        {
          key: 'print_locations', label: 'Print locations', type: 'multi_select', included_count: 1,
          choices: [
            { key: 'front',        label: 'Front',        price_delta: 3 },
            { key: 'back',         label: 'Back',         price_delta: 3 },
            { key: 'left_chest',   label: 'Left chest',   price_delta: 2.5 },
            { key: 'left_sleeve',  label: 'Left sleeve',  price_delta: 2 },
            { key: 'right_sleeve', label: 'Right sleeve', price_delta: 2 },
          ],
        },
        {
          key: 'size', label: 'Size band', type: 'single_select', required: false,
          choices: [
            { key: 'std',  label: 'XS to XL',  price_delta: 0 },
            { key: 'xxl',  label: '2XL',       price_delta: 2 },
            { key: 'xxxl', label: '3XL plus',  price_delta: 3 },
          ],
        },
        { key: 'ink_colors', label: 'Ink colours', type: 'numeric', price_per_unit: 0.5, min: 1, max: 8 },
        { key: 'rush', label: 'Rush production', type: 'boolean', required: false },
      ],
      quantity: {
        min: 1,
        tiers: [
          { min_qty: 12,  unit_multiplier: 0.9 },
          { min_qty: 50,  unit_multiplier: 0.8 },
          { min_qty: 100, unit_multiplier: 0.7 },
          { min_qty: 250, unit_multiplier: 0.6 },
        ],
      },
      modifiers: [{ key: 'rush', label: 'Rush production', type: 'pct', amount: 30 }],
    },
  },
  {
    kind: 'physical',
    title: 'Custom embroidered polo',
    description: 'Embroidered pique and performance polos, priced by stitch detail and thread count. No minimum. Quote computed from the studio rule, approved by a human before binding.',
    price_minor: 18_000_000,
    currency: 'USDC',
    stock: null,
    active: true,
    pricing_mode: 'configurable',
    on_chain_status: 'registered',
    option_schema: {
      currency: 'USDC',
      base_price: 14,
      groups: [
        {
          key: 'garment', label: 'Garment', type: 'single_select', required: true,
          choices: [
            { key: 'pique_polo',       label: 'Pique polo',       price_delta: 0 },
            { key: 'performance_polo', label: 'Performance polo', price_delta: 4 },
            { key: 'ladies_polo',      label: 'Ladies cut polo',  price_delta: 2 },
          ],
        },
        {
          key: 'embroidery_locations', label: 'Embroidery locations', type: 'multi_select', included_count: 1,
          choices: [
            { key: 'left_chest',  label: 'Left chest',  price_delta: 5 },
            { key: 'right_chest', label: 'Right chest', price_delta: 5 },
            { key: 'left_sleeve', label: 'Left sleeve', price_delta: 4 },
            { key: 'nape',        label: 'Inner nape',  price_delta: 4 },
            { key: 'back',        label: 'Full back',   price_delta: 7 },
          ],
        },
        {
          key: 'stitch_density', label: 'Stitch detail', type: 'single_select', required: false,
          choices: [
            { key: 'standard',    label: 'Standard',    price_delta: 0 },
            { key: 'high_detail', label: 'High detail', price_delta: 3 },
          ],
        },
        { key: 'thread_colors', label: 'Thread colours', type: 'numeric', price_per_unit: 1, min: 1, max: 12 },
        { key: 'rush', label: 'Rush production', type: 'boolean', required: false },
      ],
      quantity: {
        min: 1,
        tiers: [
          { min_qty: 6,   unit_multiplier: 0.95 },
          { min_qty: 24,  unit_multiplier: 0.85 },
          { min_qty: 72,  unit_multiplier: 0.75 },
          { min_qty: 144, unit_multiplier: 0.65 },
        ],
      },
      modifiers: [{ key: 'rush', label: 'Rush production', type: 'pct', amount: 35 }],
    },
  },
  {
    kind: 'physical',
    title: 'Custom pullover hoodie',
    description: 'Heavyweight pullover and full zip hoodies, printed or embroidered. No minimum. Advisory quote from the studio rule, human approved before binding.',
    price_minor: 28_000_000,
    currency: 'USDC',
    stock: null,
    active: true,
    pricing_mode: 'configurable',
    on_chain_status: 'registered',
    option_schema: {
      currency: 'USDC',
      base_price: 22,
      groups: [
        {
          key: 'garment', label: 'Garment', type: 'single_select', required: true,
          choices: [
            { key: 'midweight',   label: 'Midweight pullover',   price_delta: 0 },
            { key: 'heavyweight', label: 'Heavyweight pullover', price_delta: 6 },
            { key: 'zip',         label: 'Full zip',             price_delta: 8 },
          ],
        },
        {
          key: 'print_method', label: 'Decoration method', type: 'single_select', required: true,
          choices: [
            { key: 'screen_print', label: 'Screen print',           price_delta: 3 },
            { key: 'dtg',          label: 'Direct to garment',      price_delta: 4 },
            { key: 'dtf',          label: 'Direct to film transfer', price_delta: 4.5 },
            { key: 'embroidery',   label: 'Embroidery',             price_delta: 7 },
          ],
        },
        {
          key: 'print_locations', label: 'Decoration locations', type: 'multi_select', included_count: 1,
          choices: [
            { key: 'front',      label: 'Front',      price_delta: 4 },
            { key: 'back',       label: 'Back',       price_delta: 4 },
            { key: 'left_chest', label: 'Left chest', price_delta: 3 },
            { key: 'hood',       label: 'Hood',       price_delta: 4 },
            { key: 'sleeve',     label: 'Sleeve',     price_delta: 3 },
          ],
        },
        {
          key: 'size', label: 'Size band', type: 'single_select', required: false,
          choices: [
            { key: 'std',  label: 'XS to XL',  price_delta: 0 },
            { key: 'xxl',  label: '2XL',       price_delta: 3 },
            { key: 'xxxl', label: '3XL plus',  price_delta: 5 },
          ],
        },
        { key: 'rush', label: 'Rush production', type: 'boolean', required: false },
      ],
      quantity: {
        min: 1,
        tiers: [
          { min_qty: 12,  unit_multiplier: 0.92 },
          { min_qty: 48,  unit_multiplier: 0.82 },
          { min_qty: 100, unit_multiplier: 0.72 },
        ],
      },
      modifiers: [{ key: 'rush', label: 'Rush production', type: 'pct', amount: 30 }],
    },
  },
];

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

async function upsertProduct(sellerId, product) {
  const { data: existing } = await db
    .from('app_seller_products')
    .select('id').eq('seller_id', sellerId).eq('title', product.title).maybeSingle();

  if (existing) {
    const { error } = await db.from('app_seller_products')
      .update({ ...product, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw new Error(`product update (${product.title}): ${error.message}`);
    console.log(`[seed] updated product ${existing.id}  ${product.title}`);
    return existing.id;
  }
  const { data, error } = await db.from('app_seller_products')
    .insert({ ...product, seller_id: sellerId })
    .select('id').single();
  if (error) throw new Error(`product insert (${product.title}): ${error.message}`);
  console.log(`[seed] created product ${data.id}  ${product.title}`);
  return data.id;
}

(async () => {
  console.log('──── Seed Inkside Press (configurable negotiation reference) ────');

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

  const ids = [];
  for (const product of PRODUCTS) {
    ids.push(await upsertProduct(sellerId, product));
  }

  console.log('──── Done ────');
  console.log(`Seller:   ${SELLER.name}  (/sellers/${SLUG})`);
  console.log(`MCP:      /sellers/${SLUG}/mcp`);
  console.log(`Admin:    /seller/${SLUG}/admin/quotes`);
  console.log(`Products: ${ids.length} configurable, registered + active`);
  console.log('\nNext: call list_products, then get_offering_schema and request_quote against the MCP endpoint.');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
