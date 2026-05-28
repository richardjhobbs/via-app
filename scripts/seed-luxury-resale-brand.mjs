/**
 * scripts/seed-luxury-resale-brand.mjs
 *
 * Generic seed + vision-enrichment script for curated luxury-resale brands.
 *
 * Use case: a brand whose inventory is NOT a Shopify mirror — hand-picked
 * pre-loved luxury items with rich agent-facing metadata. The first
 * consumer is "Maison Archive" (the demo storefront for the Vestiaire
 * Collective partnership pitch), but the script is brand-agnostic.
 *
 * Differences from brand-mirror.mjs:
 *   - No Shopify dependency (input is a hand-curated JSON file)
 *   - No rrg_product_variants (single-SKU, single-size per item)
 *   - No on-chain registerDrop (demo flow stops at the USDC payment screen)
 *   - Calls Claude Sonnet 4.5 with vision to produce agent-facing metadata
 *     (agent_description + structured product_attributes)
 *
 * Usage:
 *   node scripts/seed-luxury-resale-brand.mjs --brand maison-archive --seed-brand-only
 *   node scripts/seed-luxury-resale-brand.mjs --brand maison-archive --enrich-only
 *   node scripts/seed-luxury-resale-brand.mjs --brand maison-archive --dry-run
 *   node scripts/seed-luxury-resale-brand.mjs --brand maison-archive
 *
 * Inputs:
 *   data/{slug}-brand.json    — brand row config (see below)
 *   data/{slug}-input.json    — array of raw product items
 *
 * Output (when --enrich-only):
 *   data/{slug}-enriched.json — for sanity-checking before committing to DB
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   ANTHROPIC_API_KEY (or CLAUDE_API_KEY)
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { randomUUID } from 'crypto';

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

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: Supabase env missing'); process.exit(1); }

const db        = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
// Anthropic only required when enriching — defer the check until then.
const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;
const BUCKET    = 'rrg-submissions';

// EUR → USDC conversion (per plan: flat 1.08)
const EUR_TO_USDC = 1.08;

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};

const BRAND_SLUG       = flag('--brand');
const DRY_RUN          = args.includes('--dry-run');
const SEED_BRAND_ONLY  = args.includes('--seed-brand-only');
const ENRICH_ONLY      = args.includes('--enrich-only');
const USE_PRECOMPUTED  = args.includes('--use-precomputed');
const FORCE            = args.includes('--force');

if (!BRAND_SLUG) {
  console.error('Usage: node scripts/seed-luxury-resale-brand.mjs --brand <slug> [--seed-brand-only|--enrich-only|--dry-run|--force]');
  process.exit(1);
}

const BRAND_CONFIG_PATH  = resolve(process.cwd(), `data/${BRAND_SLUG}-brand.json`);
const INPUT_PATH         = resolve(process.cwd(), `data/${BRAND_SLUG}-input.json`);
const ENRICHED_OUT_PATH  = resolve(process.cwd(), `data/${BRAND_SLUG}-enriched.json`);
const IMAGES_DIR         = resolve(process.cwd(), `data/${BRAND_SLUG}-images`);

// ── Vision-enrichment system prompt ──────────────────────────────────
//
// Per the plan: this is THE demo's payload. The agent_description field
// is a 150-200 word natural-language paragraph that lets a buyer's agent
// reason over the item — encoding style, provenance, condition, value
// signal, and buyer fit in one dense block.
//
const SYSTEM_PROMPT = `You are a product data writer for Real Real Genuine, an agent-facing commerce platform serving Maison Archive — a curated pre-loved luxury resale shop with authenticated inventory.

You will be given:
1. One or more high-resolution images of a single luxury item
2. Raw scraped data: brand, name, category, price_eur, condition, size, original_description, source_url

Your job: produce a strict JSON object with two purposes:
(A) Structured attributes an AI agent can filter on
(B) A 150-200 word "agent_description" that lets an AI agent reason about whether this item fits a buyer's intent — encoding style, provenance, condition, value signal, and buyer fit in one dense block. Avoid marketing fluff. No invented facts. No size advice.

Return strict JSON, no prose around it:
{
  "title": "<concise display title, 4-8 words, e.g. 'Beige Suede Double RL Jacket'>",
  "brand_context": "<1-2 sentences: what this house represents in the luxury market — heritage, signature aesthetic, resale strength>",
  "condition_grade": "<one of: Pristine | Excellent | Very Good | Good | Fair>",
  "condition_detail": "<2-3 sentences: visible wear specifics from the images and original description>",
  "visual_description": "<3-4 sentences: physical specifics — silhouette, construction, materials, colorway, hardware, details visible in the images>",
  "style_tags": ["<5-10 short tags, e.g. 'minimal', 'workwear', 'monogram', 'structured', 'archival'>"],
  "occasion_fit": ["<3-6 contexts this works for, e.g. 'work', 'evening', 'weekend', 'travel', 'formal'>"],
  "agent_description": "<150-200 words written for an AI agent to reason over. Encode style + provenance + condition + resale-value signal + buyer-fit in one dense paragraph. Use natural language, not bullets.>",
  "buyer_intent_signals": ["<5-8 phrases a buyer's agent might match against, e.g. 'investment piece', 'one-of-a-kind colorway', 'classic silhouette that holds value'>"],
  "resale_value_context": "<1-2 sentences: how this item performs in secondary markets, e.g. 'Cartier rings hold ~85% of retail value at resale'>",
  "image_is_dark": <boolean: true if the SUBJECT in the primary image is predominantly dark, false if light/bright. Drives the adaptive card-background contrast logic.>
}`;

// ── Helpers ──────────────────────────────────────────────────────────

function loadJson(path, label) {
  if (!existsSync(path)) {
    console.error(`FATAL: ${label} not found at ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function detectImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)
    return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
    return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}

async function readLocalImage(relPath) {
  // relPath is either relative to data/{slug}-images/ or absolute
  const full = relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)
    ? relPath
    : join(IMAGES_DIR, relPath);
  if (!existsSync(full)) throw new Error(`image not found: ${full}`);
  const buf = readFileSync(full);
  const fmt = detectImage(buf);
  if (!fmt) throw new Error(`image format unrecognised: ${full}`);
  return { buf, fmt };
}

async function uploadImageToSupabase(buf, fmt, submissionId, idx) {
  const filename = `${idx === 0 ? 'primary' : `img-${idx}`}.${fmt.ext}`;
  const path = `submissions/${submissionId}/jpeg/${filename}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, {
    contentType: fmt.mime,
    upsert: false,
  });
  if (error) throw new Error(`storage upload (${path}): ${error.message}`);
  return { path, filename, size: buf.length };
}

// ── Token ID allocation (mirrors brand-mirror.mjs) ───────────────────
let _dryRunTokenCounter = null;
async function claimNextTokenId() {
  const { data: cfg, error: e1 } = await db
    .from('rrg_config').select('value').eq('key', 'next_token_id').single();
  if (e1) throw new Error(`rrg_config read: ${e1.message}`);
  const current = parseInt(cfg.value, 10);
  if (DRY_RUN) {
    // Don't mutate the counter; show sequential previews.
    if (_dryRunTokenCounter === null) _dryRunTokenCounter = current;
    return _dryRunTokenCounter++;
  }
  const next = current + 1;
  const { error: e2 } = await db
    .from('rrg_config').update({ value: String(next) }).eq('key', 'next_token_id');
  if (e2) throw new Error(`rrg_config update: ${e2.message}`);
  return current;
}

// ── PHASE 1: Brand seed ──────────────────────────────────────────────
async function ensureBrand(brandConfig) {
  console.log(`[seed] brand slug=${brandConfig.slug} (${brandConfig.name})`);

  // Upload logo + banner if local paths supplied and brand row needs them
  const { data: existing } = await db
    .from('app_sellers')
    .select('*')
    .eq('slug', brandConfig.slug)
    .maybeSingle();

  // Resolve banner/logo paths — upload locals to Supabase if needed
  let logoPath = brandConfig.logo_path ?? existing?.logo_path ?? null;
  let bannerPath = brandConfig.banner_path ?? existing?.banner_path ?? null;

  // Logo + banner: upload if local file exists (re-run script after dropping
  // assets in to upload them). Missing locals are non-fatal — the storefront
  // renders gracefully without them.
  if (brandConfig.logo_local) {
    try {
      const { buf, fmt } = await readLocalImage(brandConfig.logo_local);
      const path = `brands/${brandConfig.slug}/logo.${fmt.ext}`;
      if (!DRY_RUN) {
        const { error } = await db.storage.from(BUCKET).upload(path, buf, {
          contentType: fmt.mime, upsert: true,
        });
        if (error) throw new Error(`logo upload: ${error.message}`);
      }
      logoPath = path;
      console.log(`[seed] uploaded logo → ${path}`);
    } catch (e) {
      if (e.message?.includes('not found')) {
        console.log(`[seed] logo_local "${brandConfig.logo_local}" not present yet — skipping (re-run after dropping it in)`);
      } else throw e;
    }
  }

  if (brandConfig.banner_local) {
    try {
      const { buf, fmt } = await readLocalImage(brandConfig.banner_local);
      const path = `brands/${brandConfig.slug}/banner.${fmt.ext}`;
      if (!DRY_RUN) {
        const { error } = await db.storage.from(BUCKET).upload(path, buf, {
          contentType: fmt.mime, upsert: true,
        });
        if (error) throw new Error(`banner upload: ${error.message}`);
      }
      bannerPath = path;
      console.log(`[seed] uploaded banner → ${path}`);
    } catch (e) {
      if (e.message?.includes('not found')) {
        console.log(`[seed] banner_local "${brandConfig.banner_local}" not present yet — skipping (re-run after dropping it in)`);
      } else throw e;
    }
  }

  if (existing) {
    console.log(`[seed] brand exists id=${existing.id} — updating mutable fields`);
    if (!DRY_RUN) {
      const update = {
        name:             brandConfig.name,
        headline:         brandConfig.headline,
        description:      brandConfig.description,
        website_url:      brandConfig.website,
        contact_email:    brandConfig.email,
        wallet_address:   String(brandConfig.wallet).toLowerCase(),
        social_links:     brandConfig.socialLinks ?? existing.social_links ?? {},
        supports_sizing:  brandConfig.supportsSizing ?? false,
        shopify_domain:   brandConfig.shopifyDomain ?? null,
        logo_path:        logoPath,
        banner_path:      bannerPath,
        ...(brandConfig.brand_pct_override != null
          ? { brand_pct_override: brandConfig.brand_pct_override }
          : {}),
      };
      const { error } = await db.from('app_sellers').update(update).eq('id', existing.id);
      if (error) throw new Error(`brand update: ${error.message}`);
    }
    return { ...existing, logo_path: logoPath, banner_path: bannerPath };
  }

  // Insert
  const id = randomUUID();
  const insert = {
    id,
    slug:               brandConfig.slug,
    name:               brandConfig.name,
    headline:           brandConfig.headline,
    description:        brandConfig.description,
    website_url:        brandConfig.website,
    contact_email:      brandConfig.email,
    wallet_address:     String(brandConfig.wallet).toLowerCase(),
    status:             'active',
    max_self_listings:  brandConfig.max_self_listings ?? 50,
    self_listings_used: 0,
    tc_accepted_at:     new Date().toISOString(),
    tc_version:         '1.0',
    social_links:       brandConfig.socialLinks ?? {},
    supports_sizing:    brandConfig.supportsSizing ?? false,
    shopify_domain:     brandConfig.shopifyDomain ?? null,
    logo_path:          logoPath,
    banner_path:        bannerPath,
    ...(brandConfig.brand_pct_override != null
      ? { brand_pct_override: brandConfig.brand_pct_override }
      : {}),
  };

  if (DRY_RUN) {
    console.log('[seed] DRY: would insert brand row');
    return null;
  }

  const { data, error } = await db.from('app_sellers').insert(insert).select().single();
  if (error) throw new Error(`brand insert: ${error.message}`);
  console.log(`[seed] created brand id=${data.id}`);
  return data;
}

// ── PHASE 2: Vision enrichment ───────────────────────────────────────
async function enrichItem(item) {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY (or CLAUDE_API_KEY) required for enrichment — add to .env.local');
  }
  // Read all images for this item (paths relative to data/{slug}-images/)
  const imagePaths = item.images ?? [];
  if (imagePaths.length === 0) throw new Error(`item "${item.name}" has no images`);

  const imageContents = [];
  const imageBuffers = []; // hold for later upload
  for (const p of imagePaths) {
    const { buf, fmt } = await readLocalImage(p);
    imageBuffers.push({ buf, fmt });
    imageContents.push({
      type: 'image',
      source: { type: 'base64', media_type: fmt.mime, data: buf.toString('base64') },
    });
  }

  const userText = `RAW INPUT:
- brand: ${item.brand}
- name: ${item.name}
- category: ${item.category}
- price_eur: ${item.price_eur}
- condition: ${item.condition}
- size: ${item.size ?? 'one size'}
- source_url: ${item.source_url}

ORIGINAL DESCRIPTION (from source listing):
${item.original_description ?? '(none provided)'}

Analyze the image(s) and return the strict JSON specified in the system prompt.`;

  const resp = await anthropic.messages.create({
    model:       'claude-sonnet-4-5',
    max_tokens:  2500,
    system:      SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: [...imageContents, { type: 'text', text: userText }] }],
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`no JSON found in Claude response: ${text.slice(0, 300)}`);
  const enriched = JSON.parse(jsonMatch[0]);

  return {
    enriched,
    imageBuffers,
    tokensIn:  resp.usage.input_tokens,
    tokensOut: resp.usage.output_tokens,
  };
}

// ── PHASE 3: DB insert ───────────────────────────────────────────────
async function insertProduct(brand, item, enrichResult, imageBuffers) {
  const submissionId = randomUUID();

  // Upload images to Supabase
  const uploaded = [];
  for (let i = 0; i < imageBuffers.length; i++) {
    const { buf, fmt } = imageBuffers[i];
    const u = await uploadImageToSupabase(buf, fmt, submissionId, i);
    uploaded.push(u);
  }

  const tokenId = await claimNextTokenId();

  const enriched = enrichResult;
  const priceUsdc = (item.price_eur * EUR_TO_USDC).toFixed(2);

  const product_attributes = {
    brand:                 item.brand,
    brand_context:         enriched.brand_context,
    category:              item.category,
    price_eur:             item.price_eur,
    condition_grade:       enriched.condition_grade,
    condition_detail:      enriched.condition_detail,
    visual_description:    enriched.visual_description,
    style_tags:            enriched.style_tags ?? [],
    occasion_fit:          enriched.occasion_fit ?? [],
    buyer_intent_signals:  enriched.buyer_intent_signals ?? [],
    authentication_status: 'Vestiaire Verified',
    resale_value_context:  enriched.resale_value_context,
    size:                  item.size ?? 'one size',
    source_url:            item.source_url,
  };

  const insertRow = {
    id:                  submissionId,
    creator_wallet:      String(brand.wallet_address).toLowerCase(),
    creator_email:       brand.contact_email,
    title:               (enriched.title || item.name).slice(0, 80),
    description:         item.original_description ?? null,
    enhanced_description: enriched.agent_description,
    product_attributes,
    enhanced_at:         new Date().toISOString(),
    image_is_dark:       enriched.image_is_dark === true ? true
                          : enriched.image_is_dark === false ? false
                          : null,
    submission_channel:  'brand',
    status:              'approved',
    jpeg_storage_path:   uploaded[0].path,
    jpeg_filename:       uploaded[0].filename,
    jpeg_size_bytes:     uploaded[0].size,
    physical_images_paths: uploaded.slice(1).map(u => u.path),
    brand_id:            brand.id,
    creator_type:        'human',
    is_brand_product:    true,
    is_physical_product: true,
    physical_description: enriched.condition_detail,
    token_id:            tokenId,
    edition_size:        1,
    price_usdc:          priceUsdc,
    approved_at:         new Date().toISOString(),
    network:             'base',
    ecommerce_url:       item.source_url,
    shipping_type:       'included',
    shipping_included_regions: ['US', 'UK', 'EU', 'Asia-Pacific', 'Middle East', 'Africa', 'South America', 'Oceania', 'Other'],
    refund_commitment:   true,
    trust_behavior_accepted: true,
    has_voucher:         false,
    hidden:              false,
  };

  if (DRY_RUN) {
    console.log(`[insert] DRY: would insert token #${tokenId} title="${insertRow.title}" price=$${priceUsdc} (€${item.price_eur})`);
    return { tokenId, submissionId };
  }

  const { error } = await db.from('rrg_submissions').insert(insertRow);
  if (error) throw new Error(`submission insert: ${error.message}`);

  await db.from('app_sellers')
    .update({ self_listings_used: (brand.self_listings_used ?? 0) + 1 })
    .eq('id', brand.id);
  brand.self_listings_used = (brand.self_listings_used ?? 0) + 1;

  return { tokenId, submissionId };
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  console.log(`──── Seed luxury-resale brand: ${BRAND_SLUG} ────`);
  console.log(`Mode: ${DRY_RUN ? 'DRY' : 'LIVE'} | seed-brand-only=${SEED_BRAND_ONLY} | enrich-only=${ENRICH_ONLY} | force=${FORCE}`);
  console.log();

  // Load brand config
  const brandConfig = loadJson(BRAND_CONFIG_PATH, 'brand config');
  const brand = await ensureBrand(brandConfig);
  if (!brand) { console.log('[done] dry seed — exiting'); return; }

  if (SEED_BRAND_ONLY) {
    console.log('[done] seed-brand-only — exiting');
    return;
  }

  // Two modes:
  //   - default: read INPUT_PATH (raw items) → enrich via Claude vision → insert
  //   - --use-precomputed: read ENRICHED_OUT_PATH (pre-computed [{input, enriched}]) → skip API → insert
  let items;
  let precomputed = null;
  if (USE_PRECOMPUTED) {
    precomputed = loadJson(ENRICHED_OUT_PATH, 'precomputed enriched');
    if (!Array.isArray(precomputed)) {
      console.error('FATAL: precomputed file must be an array of {input, enriched} objects');
      process.exit(1);
    }
    items = precomputed.map(p => p.input);
    console.log(`[items] ${items.length} item(s) loaded from precomputed enrichment\n`);
  } else {
    items = loadJson(INPUT_PATH, 'product input');
    if (!Array.isArray(items)) {
      console.error('FATAL: input must be an array of items');
      process.exit(1);
    }
    console.log(`[items] ${items.length} item(s) to enrich + insert\n`);
  }

  // Skip already-listed items unless --force
  const seen = new Set();
  if (!FORCE) {
    const { data: existing } = await db
      .from('rrg_submissions')
      .select('product_attributes')
      .eq('brand_id', brand.id);
    for (const row of existing ?? []) {
      const url = row.product_attributes?.source_url;
      if (url) seen.add(url);
    }
    if (seen.size > 0) console.log(`[items] ${seen.size} existing source_url(s) will be skipped (use --force to override)\n`);
  }

  let processed = 0, skipped = 0, errored = 0;
  let totalIn = 0, totalOut = 0;
  const enrichedAll = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const label = `${item.brand} — ${item.name}`;
    console.log(`──── ${label} ────`);

    if (seen.has(item.source_url)) {
      console.log(`[skip] already listed (source_url match)`);
      skipped++;
      continue;
    }

    try {
      let enriched, imageBuffers;

      if (USE_PRECOMPUTED) {
        enriched = precomputed[i].enriched;
        // Still need to read images for upload
        imageBuffers = [];
        for (const p of (item.images ?? [])) {
          imageBuffers.push(await readLocalImage(p));
        }
        console.log(`[precomputed] using cached enrichment + ${imageBuffers.length} local image(s)`);
      } else {
        console.log(`[enrich] calling claude-sonnet-4-5 with ${(item.images ?? []).length} image(s)…`);
        const r = await enrichItem(item);
        enriched = r.enriched;
        imageBuffers = r.imageBuffers;
        totalIn += r.tokensIn; totalOut += r.tokensOut;
        console.log(`  → tokens: ${r.tokensIn} in / ${r.tokensOut} out`);
      }

      console.log(`  → title:           ${enriched.title}`);
      console.log(`  → condition_grade: ${enriched.condition_grade}`);
      console.log(`  → style_tags:      ${(enriched.style_tags ?? []).join(', ')}`);
      console.log(`  → occasion_fit:    ${(enriched.occasion_fit ?? []).join(', ')}`);
      console.log(`  → image_is_dark:   ${enriched.image_is_dark}`);
      console.log(`  → agent_description: ${(enriched.agent_description ?? '').slice(0, 160)}…`);

      enrichedAll.push({ input: item, enriched });

      if (ENRICH_ONLY) {
        console.log(`[enrich-only] skipping DB insert`);
      } else {
        const { tokenId } = await insertProduct(brand, item, enriched, imageBuffers);
        console.log(`  ✓ inserted token #${tokenId} → /rrg/drop/${tokenId}`);
      }

      processed++;
    } catch (e) {
      console.error(`  FAIL: ${e.message}`);
      errored++;
    }
    console.log();
  }

  if (ENRICH_ONLY) {
    writeFileSync(ENRICHED_OUT_PATH, JSON.stringify(enrichedAll, null, 2));
    console.log(`[enrich-only] wrote ${enrichedAll.length} enriched record(s) → ${ENRICHED_OUT_PATH}`);
  }

  // Cost: claude-sonnet-4-5 ~ $3/M input, $15/M output
  const cost = (totalIn * 3 + totalOut * 15) / 1_000_000;

  console.log(`──── Done ────`);
  console.log(`Processed: ${processed} | Skipped: ${skipped} | Errored: ${errored}`);
  console.log(`Tokens: ${totalIn} in / ${totalOut} out`);
  console.log(`Est. cost: $${cost.toFixed(4)}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
