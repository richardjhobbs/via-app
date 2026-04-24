/**
 * scripts/enhance-descriptions.mjs
 *
 * LLM-enhanced product descriptions for garment brands.
 *
 * Purpose: brand marketing copy is often conceptual ("Beyond the Door Tee
 * embodies seeking connections beyond borders"). Buyers want product
 * specifics — fabric, fit, construction, colors.
 *
 * This script:
 *   1. For each product: downloads the main image
 *   2. Sends it to Claude 4.6 Sonnet vision with the brand's conceptual
 *      copy as context
 *   3. Gets back a structured analysis (fabric guess, fit, construction
 *      details, color palette) + a rewritten buyer-focused description
 *      that PRESERVES the brand voice but adds physical specifics
 *   4. Stores enhanced_description + product_attributes in rrg_submissions
 *
 * The drop page prefers enhanced_description when present, falls back to
 * the original physical_description otherwise.
 *
 * Cost: ~$0.02-0.04 per product (one Claude call per product).
 *
 * Usage:
 *   node scripts/enhance-descriptions.mjs --brand unknown-union
 *   node scripts/enhance-descriptions.mjs --brand unknown-union --token 68
 *   node scripts/enhance-descriptions.mjs --brand unknown-union --dry-run
 *   node scripts/enhance-descriptions.mjs --brand unknown-union --force  (re-run even if enhanced exists)
 *
 *   # Precomputed path — skip the API entirely (zero LLM spend). Expects a
 *   # JSON array of { token_id, attributes, enhanced_description } matching
 *   # the Claude output schema. Useful when the agent running this pipeline
 *   # has already produced the enrichment in another context.
 *   node scripts/enhance-descriptions.mjs --brand frey-tailored \
 *     --use-precomputed tmp/frey-enrichment.json
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   ANTHROPIC_API_KEY (or CLAUDE_API_KEY)  -- NOT required when --use-precomputed
 */

import Anthropic from '@anthropic-ai/sdk';
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
  console.error('FATAL: could not read .env.local');
  process.exit(1);
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: Supabase env missing'); process.exit(1); }

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};
const BRAND_SLUG       = flag('--brand');
const ONLY_TOKEN       = flag('--token') ? parseInt(flag('--token'), 10) : null;
const DRY_RUN          = args.includes('--dry-run');
const FORCE            = args.includes('--force');
const PRECOMPUTED_PATH = flag('--use-precomputed'); // path to JSON array of { token_id, attributes, enhanced_description }

// Anthropic key is required ONLY when we're actually calling the API.
if (!PRECOMPUTED_PATH && !ANTHROPIC_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY or CLAUDE_API_KEY required (or pass --use-precomputed <file>)');
  process.exit(1);
}

const db        = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

const BUCKET = 'rrg-submissions';

if (!BRAND_SLUG) {
  console.error('Usage: node scripts/enhance-descriptions.mjs --brand <slug> [--token <N>] [--dry-run] [--force]');
  process.exit(1);
}

// ── Prompt ───────────────────────────────────────────────────────────
//
// IMPORTANT: enhanced descriptions are for AGENTS consuming the per-brand
// MCP, NOT for human visitors. The drop page renders the brand's original
// description for humans. Agents get the enhanced description + structured
// attributes via `get_product` on /brand/{slug}/mcp.
//
// This prompt is deliberately tight: we want STRUCTURED attributes that
// agents can filter on (fabric/fit/colors) plus a 3-5 sentence description
// that preserves brand voice but adds physical facts.
//
// Cost target: ~$0.02-0.04 per product on Claude Sonnet 4.5. We will
// evaluate cheaper vision-capable models (Haiku, Gemini Flash, etc) for
// production scaling — the prompt is model-agnostic.
//
// ── Merchant-aware enhancement prompts ────────────────────────────────
//
// Every product routed through this script must end up with an
// agent-readable enhanced_description plus a product_attributes JSON
// that an agent can filter on. The schema diverges by merchant type:
//
//   direct_brand          — image analysis + product specifics + brand voice
//   reseller_authenticated — direct-brand fields PLUS authentication anchors
//                            (retail_sku, original_release, authenticator,
//                             provenance, resale value context)
//   curated_consignment   — single-piece pre-loved luxury resale shape
//                            (condition grade, brand context, resale value)
//
// The mode is resolved at runtime from
// rrg_brands.brand_data.merchant_type, with a per-row override of
// rrg_submissions.product_attributes.resale_mode === true flipping any
// direct-brand product into reseller mode (e.g. a direct brand listing a
// one-off archive piece tagged "vintage" in Shopify).
//
// Auto-seeded attributes already on the row (vendor, product_type,
// shopify_tags, retail_sku parsed from Shopify SKU) are PRESERVED through
// the merge — the LLM's output augments them, never overwrites.

const DIRECT_BRAND_PROMPT = `You are a product data writer for Real Real Genuine, an agent-facing commerce platform.

You will be given:
1. An image of a garment or product (flat-lay, on-model, or product photo)
2. The brand's original conceptual description (often abstract/thematic)
3. The product title
4. Any auto-seeded facts already extracted from the source (vendor, product type, tags)

Your job:
A) Extract STRUCTURED attributes from the image (for agent filtering)
B) Rewrite the description for agent consumption: preserves brand voice and concept
   but adds physical specifics (fabric guess, fit, silhouette, graphic details).
   3-5 sentences. No sizing advice (that's a separate chart). No invented facts.

Return strict JSON (no prose around it):
{
  "attributes": {
    "fabric_guess":     "material best guess (e.g. 'midweight cotton jersey', 'heavyweight wool/cotton knit')",
    "fit":              "slim | regular | relaxed | oversized | boxy | true to size",
    "silhouette":       "concrete shape (e.g. 'crew-neck short-sleeve boxy tee')",
    "primary_color":    "dominant color word",
    "secondary_colors": ["accent colors"],
    "graphic_details":  "printed/embroidered graphics visible + approximate position",
    "construction":     "visible construction details (seams, hems, trim, closures, reinforcement, labels)",
    "styling_hints":    "how the garment might pair or layer",
    "style_tags":       ["5-10 short filterable tags, e.g. 'minimal', 'workwear', 'monogram', 'structured', 'archival'"],
    "occasion_fit":     ["3-6 contexts this works for, e.g. 'work', 'evening', 'weekend', 'travel', 'formal'"]
  },
  "enhanced_description": "3-5 sentences preserving brand voice and weaving in the physical details."
}`;

const RESELLER_PROMPT = `You are a product data writer for Real Real Genuine, an agent-facing commerce platform. This product comes from an AUTHENTICATED RESELLER (a sneaker / streetwear / fashion consignment marketplace that authenticates every unit in-house). Agents need to be able to cross-reference what they're looking at against their own knowledge of the original release — so the output MUST surface canonical anchors: retail SKU / style code, original release name + year, authenticator, and the fact that the ERC-1155 token is a proof-of-ownership record for a physical pair (not a separate digital collectible).

You will be given:
1. An image of the product
2. The reseller's original description
3. The product title (which may embed the style code)
4. Any auto-seeded facts from Shopify (vendor, product type, tags, often a parsed retail_sku) — PRESERVE these verbatim if present, refine only if clearly wrong.

Your job:
A) Extract STRUCTURED attributes for agent filtering AND authentication anchors for legitimacy verification
B) Write a 150-200 word agent_description that encodes: what it is (canonical name + year), where it sits in its collection / collab, authenticator context, condition framing, and how it's priced vs the secondary market. Preserve the reseller's voice; add specificity. No invented facts.

Return strict JSON (no prose around it):
{
  "attributes": {
    "retail_sku":                "official style code (e.g. 'AA3834-100') — keep auto-seeded value if already present",
    "canonical_name":            "the name an agent's training data would recognise (e.g. 'Air Jordan 1 Retro High Off-White NRG (White)')",
    "original_release":          "1-2 sentences: original release (brand, line, colorway, collection) + year",
    "collab":                    "collaborator(s) if any (e.g. 'Off-White c/o Virgil Abloh x Nike (Jordan Brand)')",
    "release_year":              "e.g. '2018'",
    "authentication_status":     "who authenticated this unit + their process (keep auto-seeded value if already present)",
    "authentication_provenance": "1-2 sentences on the authenticator's credibility and their role in this category",
    "physical_token_semantics":  "Explain that the ERC-1155 minted on Base is the ownership record for the physical item, not a separate digital artwork.",
    "condition_grade":           "Pristine | Excellent | Very Good | Good | Fair",
    "condition_detail":          "1-2 sentences on visible wear / completeness (box, extras)",
    "silhouette":                "concrete shape / model family (e.g. 'Air Jordan 1 high-top basketball sneaker')",
    "construction":              "visible construction specifics",
    "fabric_guess":              "materials (leather types, suede, nylon, etc.)",
    "primary_color":             "dominant color word",
    "secondary_colors":          ["accent colors"],
    "graphic_details":           "visible graphics / markings / hangtags / signatures",
    "styling_hints":             "how a collector / buyer rotates this piece",
    "style_tags":                ["5-10 short filterable tags"],
    "occasion_fit":              ["3-6 usage contexts"],
    "buyer_intent_signals":      ["5-8 phrases a buyer's agent might match against, e.g. 'grail tier', 'investment piece', 'deadstock collector'"],
    "resale_value_context":      "1-2 sentences on how this model/release performs in secondary markets",
    "alt_names":                 ["EVERY credible alternative name, shortening, colloquial reference, collab name, abbreviation, or SKU format an agent or collector might use to search for THIS specific item. Include the model number with AND without dashes/spaces. Include the designer/collaborator's name alone if widely used. Include era/collection nicknames. Include the colorway nickname if one exists. This field is the primary recall mechanism when naming clusters diverge (e.g. 'VAA', 'V.A.A.', 'Off-White', 'The Ten', 'Virgil Abloh Archive' for one item). 8-15 entries for well-known resale items."]
  },
  "enhanced_description": "150-200 word agent-readable paragraph. Lead with canonical identity (what it is, from where, what year). Weave in authentication + condition + provenance. Close with pricing context and buyer fit. No marketing fluff."
}`;

const CONSIGNMENT_PROMPT = `You are a product data writer for Real Real Genuine, an agent-facing commerce platform, serving a CURATED CONSIGNMENT shop (pre-loved luxury resale — single-piece inventory, per-item condition, no runs or SKUs). Agents reasoning over the item need: style, provenance, condition, value signal, and buyer fit in one dense block.

You will be given:
1. One or more high-resolution images of a single luxury item
2. Raw scraped data: brand, category, price, condition, size, original description
3. Any auto-seeded facts from the source.

Your job: produce strict JSON with (A) structured attributes an agent can filter on, (B) a 150-200 word agent_description that lets an AI buyer's agent decide whether this fits its buyer.

Return strict JSON (no prose around it):
{
  "attributes": {
    "brand_context":        "1-2 sentences: what this house represents in luxury — heritage, signature aesthetic, resale strength",
    "condition_grade":      "Pristine | Excellent | Very Good | Good | Fair",
    "condition_detail":     "2-3 sentences: visible wear specifics",
    "visual_description":   "3-4 sentences: silhouette, construction, materials, colorway, hardware, details visible in images",
    "authentication_status":"who authenticated (leave auto-seeded value if present)",
    "style_tags":           ["5-10 short filterable tags"],
    "occasion_fit":         ["3-6 contexts"],
    "buyer_intent_signals": ["5-8 phrases a buyer's agent matches against"],
    "resale_value_context": "1-2 sentences on how this item/category performs in secondary markets",
    "alt_names":            ["Alternative names, colloquial references, designer shortforms, era nicknames, or house codes an agent might search for. Include the designer's name alone, any collection nickname, and any widely-used shortform. 5-10 entries."],
    "image_is_dark":        "boolean: true if SUBJECT is predominantly dark (card bg contrast hint)"
  },
  "enhanced_description": "150-200 word agent-readable paragraph encoding style + provenance + condition + resale-value signal + buyer-fit. No invented facts. No size advice."
}`;

// ── Category-aware attribute blocks ──────────────────────────────────
//
// Mode (direct_brand | reseller_authenticated | curated_consignment)
// controls what commerce-side anchors the prompt demands (authentication,
// condition, resale context). Category controls the PRODUCT-side
// attribute schema — sneakers need outsole + colorway code, watches
// need movement + reference, fragrances need concentration + volume.
//
// Categories compose WITH modes: a reseller_authenticated + watch
// product gets the reseller anchors (retail_sku, original_release,
// authentication_status, alt_names) PLUS the watch-specific attributes
// (reference_number, movement, case_size_mm, complications, etc.).
//
// Keep the garment schema as the base and layer category-specific
// fields on top — keeps the prompt diff small per category and lets
// a generic product fall through to the garment shape cleanly.

const CATEGORY_ATTRIBUTE_BLOCKS = {
  footwear: `## Footwear-specific attributes
Add these to the attributes object (alongside the mode's schema):
  "silhouette":         "model family (e.g. 'Air Jordan 1 high-top basketball', 'Nike Dunk Low', 'Adidas Samba')",
  "upper_materials":    "leather / suede / mesh / knit / synthetic — per panel if mixed",
  "outsole":            "rubber herringbone / cupsole / vulcanised / translucent / etc.",
  "colorway_code":      "official colorway name if any (e.g. 'Chicago', 'Bred', 'Alaska')",
  "sizing_notation":    "primary size system used in the listing (US | UK | EU | JP)",
  "collab_mark":        "visible collab markers on the shoe itself (zip ties, stitched text, overlays)"`,

  garment: `## Garment-specific attributes (already covered by the mode schema's fabric_guess/fit/silhouette/construction/graphic_details/styling_hints — no category block needed unless the item is specialised)`,

  outerwear: `## Outerwear-specific attributes
  "closure":            "zip / snap / double-breasted / toggles / hook-and-eye",
  "lining":             "material + weight (quilted / shearling / cotton / unlined)",
  "insulation":         "if any (down fill weight, synthetic, wool pile, none)",
  "weatherproofing":    "waterproof / water-repellent / windproof / breathable / none",
  "collar_hood":        "collar style + hood presence/removable"`,

  jewellery: `## Jewellery-specific attributes
  "metal":              "material + finish (e.g. '18k yellow gold polished', 'sterling silver matte')",
  "stones":             "gemstones with cut + setting if any",
  "carat_weight":       "total carat weight if stones are present",
  "hallmark":           "any hallmark / maker's stamp visible",
  "piece_type":         "ring / necklace / bracelet / earrings / cufflinks / brooch",
  "scale":              "subtle | statement | oversized"`,

  bag: `## Bag / accessory attributes
  "material":           "leather type / canvas / nylon / etc. with finish",
  "hardware":           "metal tone + finish (gold / silver / gunmetal — polished / brushed)",
  "closure":            "zip / magnetic / flap / drawstring / open",
  "dimensions":         "W x H x D in cm or inches",
  "interior":           "lining material + pocket count",
  "carry":              "shoulder / crossbody / top-handle / clutch / tote / backpack"`,

  fragrance: `## Fragrance-specific attributes
  "concentration":      "parfum | eau de parfum | eau de toilette | eau de cologne | extrait",
  "volume_ml":          "size in ml",
  "nose":               "perfumer name if known",
  "launch_year":        "year of first release",
  "scent_family":       "woody / floral / citrus / gourmand / oriental / etc.",
  "top_heart_base":     "top / heart / base notes if discernible or documented"`,

  watch: `## Watch-specific attributes
  "reference_number":   "canonical reference (e.g. 'Ref. 5711/1A-010', '116500LN') — put in retail_sku too",
  "movement":           "manual / automatic / quartz, with caliber if known",
  "case_material":      "steel / gold / titanium / ceramic / two-tone",
  "case_size_mm":       "diameter in millimetres",
  "bracelet":           "bracelet or strap material + integration",
  "complications":      ["sub-dial / date / chronograph / GMT / moonphase / etc."],
  "dial_colour":        "dial base colour + indices treatment"`,

  eyewear: `## Eyewear-specific attributes
  "frame_material":     "acetate / metal / titanium / wood / combination",
  "lens_type":          "optical / sunglass / prescription-ready / polarised / transition",
  "shape":              "aviator / round / square / cat-eye / shield / wayfarer / etc.",
  "fit_size":           "frame width / lens width in mm if available"`,

  home: `## Home / hardware attributes
  "dimensions":         "W x H x D in cm or inches",
  "materials":          "primary materials with finish",
  "power_spec":         "voltage / wattage / battery if electronic, else null",
  "category_subtype":   "speaker / light / vase / textile / furniture / etc."`,

  art_digital: `## Art / digital-asset attributes
  "medium":             "format (jpg / mp4 / gltf / print / physical mixed media)",
  "edition_position":   "e.g. '1/25' if editioned, or 'open edition' / '1/1'",
  "signature_status":   "hand-signed / digitally-signed / unsigned",
  "creator_statement":  "1-2 sentences: creator's intent or context",
  "display_notes":      "viewing requirements (resolution / aspect / medium)"`,

  accessory: `## Small accessory attributes
  "material":           "primary material with finish",
  "piece_type":         "belt / scarf / wallet / cap / hat / gloves / tie / etc.",
  "dimensions":         "relevant dimensions (length / width)",
  "signature_marker":   "visible brand/hardware/stitch detail that confirms provenance"`,
};

// Category detection. Ordering matters — most specific first.
function resolveCategory(product, brand) {
  const attrs = product.product_attributes ?? {};
  // Explicit category set upstream wins
  if (typeof attrs.category === 'string' && CATEGORY_ATTRIBUTE_BLOCKS[attrs.category]) {
    return attrs.category;
  }

  const haystack = [
    attrs.product_type,
    attrs.vendor,
    product.title,
    Array.isArray(attrs.shopify_tags) ? attrs.shopify_tags.join(' ') : '',
    (brand.brand_data ?? {}).category_hint ?? '',
  ].filter(Boolean).join(' ').toLowerCase();

  // Keyword patterns → category. Patterns cover plurals (shoes, rings, bags)
  // where the category singular is ambiguous (e.g. "bag" vs "bags"), and
  // popular sneaker model names for footwear recall when product_type
  // isn't seeded (common for older rows imported before brand-mirror
  // started seeding product_type from Shopify).
  const patterns = [
    [/\b(sneakers?|trainers?|shoes?|footwear|boots?|loafers?|sandals?|slippers?|flip[\s-]?flops?|jordan|dunks?|yeezys?|samba|gazelle|air\s+(?:force|max|jordan)|stan\s+smith|superstar|chuck\s+taylor|vans\b)\b/, 'footwear'],
    [/\b(jackets?|coats?|parkas?|anoraks?|windbreakers?|bombers?|blazers?|overshirts?|puffers?|vests?|gilets?)\b/, 'outerwear'],
    [/\b(rings?|necklaces?|bracelets?|earrings?|pendants?|cufflinks?|brooch(?:es)?|chains?|signets?|jewellery|jewelry)\b/, 'jewellery'],
    [/\b(bags?|totes?|clutch(?:es)?|backpacks?|rucksacks?|purses?|handbags?|cross[\s-]?bod(?:y|ies)|holdalls?|duffels?)\b/, 'bag'],
    [/\b(fragrances?|perfumes?|parfum|eau\s+de|cologne|edt|edp)\b/, 'fragrance'],
    [/\b(watch(?:es)?|chronographs?|timepieces?|wrist[\s-]?watch(?:es)?)\b/, 'watch'],
    [/\b(sunglasses|eyewear|glasses|spectacles?|goggles?)\b/, 'eyewear'],
    [/\b(speakers?|lamps?|lights?|rugs?|vases?|candles?|throws?|cushions?|chairs?|stools?|tables?|furniture|homeware)\b/, 'home'],
    [/\b(prints?|artworks?|sculptures?|tapestr(?:y|ies)|editions?|gltf|mp4|digital\s+assets?)\b/, 'art_digital'],
    [/\b(belts?|scarves|scarfs?|wallets?|caps?|hats?|gloves?|ties?|pocket\s*squares?|beanies?|bandanas?|socks?|ties|scarf)\b/, 'accessory'],
    [/\b(tees?|t-shirts?|shirts?|hoodies?|sweatshirts?|sweaters?|jumpers?|knits?|trousers?|pants?|shorts?|jeans?|denim|skirts?|dress(?:es)?|gowns?|suits?)\b/, 'garment'],
  ];
  for (const [re, cat] of patterns) {
    if (re.test(haystack)) return cat;
  }
  // Default — treat as generic garment / unstructured product. Attribute
  // block is empty for 'garment' so nothing is added.
  return 'garment';
}

function systemPromptFor(mode, category) {
  let basePrompt;
  if (mode === 'reseller_authenticated') basePrompt = RESELLER_PROMPT;
  else if (mode === 'curated_consignment') basePrompt = CONSIGNMENT_PROMPT;
  else basePrompt = DIRECT_BRAND_PROMPT;

  const categoryBlock = category && CATEGORY_ATTRIBUTE_BLOCKS[category]
    ? `\n\n${CATEGORY_ATTRIBUTE_BLOCKS[category]}`
    : '';
  return basePrompt + categoryBlock;
}

function resolveMerchantMode(product, brand) {
  const attrs = product.product_attributes ?? {};
  if (attrs.resale_mode === true) return 'reseller_authenticated';
  const bd = brand.brand_data ?? {};
  const bm = bd.merchant_type;
  if (bm === 'reseller_authenticated' || bm === 'curated_consignment' || bm === 'direct_brand') return bm;
  return 'direct_brand';
}

// ── Helpers ──────────────────────────────────────────────────────────

async function getBrand() {
  const { data } = await db.from('rrg_brands').select('*').eq('slug', BRAND_SLUG).single();
  if (!data) { console.error(`Brand not found: ${BRAND_SLUG}`); process.exit(1); }
  return data;
}

async function getProducts(brandId) {
  let query = db
    .from('rrg_submissions')
    .select('id, token_id, title, description, enhanced_description, jpeg_storage_path, product_attributes, hidden')
    .eq('brand_id', brandId)
    .eq('status', 'approved');
  if (ONLY_TOKEN) query = query.eq('token_id', ONLY_TOKEN);
  const { data } = await query.order('token_id', { ascending: true });
  return data ?? [];
}

async function getImageBase64(path) {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Image download failed: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  // Detect mime from magic bytes
  let mime = 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
  else if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') mime = 'image/webp';
  return { base64: buf.toString('base64'), mime };
}

async function analyzeProduct(product, image, mode, category) {
  const seeded = product.product_attributes ?? {};
  // Tell the LLM what's already on the row so it preserves auto-seeded
  // facts (vendor, SKU, tags) and only augments / refines.
  const seededDump = Object.entries(seeded)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: image.mime, data: image.base64 },
    },
    {
      type: 'text',
      text: `PRODUCT TITLE: ${product.title}

BRAND'S ORIGINAL DESCRIPTION:
${product.description ?? '(none provided)'}

RESOLVED CATEGORY: ${category}

AUTO-SEEDED FACTS (preserve these verbatim unless clearly wrong):
${seededDump || '(none)'}

Analyze the image and return the JSON structure specified in the system prompt. Include the mode-level attributes AND the category-specific attributes for "${category}". For fields already present in the auto-seeded facts, keep the seeded value; only add the ones not yet populated.`,
    },
  ];

  const resp = await anthropic.messages.create({
    model:       'claude-sonnet-4-5',
    max_tokens:  1500,
    system:      systemPromptFor(mode, category),
    messages:    [{ role: 'user', content: userContent }],
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');
  const parsed = JSON.parse(jsonMatch[0]);

  return {
    attributes:           parsed.attributes ?? {},
    enhancedDescription:  parsed.enhanced_description ?? '',
    tokensIn:             resp.usage.input_tokens,
    tokensOut:            resp.usage.output_tokens,
  };
}

// Load precomputed enrichment keyed by token_id when --use-precomputed <file> is set.
function loadPrecomputed(pathArg) {
  const p = resolve(process.cwd(), pathArg);
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(arr)) throw new Error(`precomputed file must be a JSON array`);
  const map = new Map();
  for (const row of arr) {
    if (row.token_id == null) throw new Error(`precomputed row missing token_id: ${JSON.stringify(row).slice(0,120)}`);
    if (!row.attributes || !row.enhanced_description) {
      throw new Error(`precomputed row ${row.token_id} missing attributes or enhanced_description`);
    }
    map.set(Number(row.token_id), row);
  }
  return map;
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  console.log(`──── Enhance descriptions: ${BRAND_SLUG} ────`);
  console.log(`Dry run: ${DRY_RUN ? 'YES' : 'no'} | Force: ${FORCE ? 'YES' : 'no'} | Token filter: ${ONLY_TOKEN ?? 'all'}${PRECOMPUTED_PATH ? ` | Precomputed: ${PRECOMPUTED_PATH}` : ''}`);
  console.log();

  const precomputed = PRECOMPUTED_PATH ? loadPrecomputed(PRECOMPUTED_PATH) : null;
  if (precomputed) console.log(`[precomputed] loaded ${precomputed.size} enrichment record(s)\n`);

  const brand = await getBrand();
  const products = await getProducts(brand.id);
  console.log(`Found ${products.length} product(s)\n`);

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let processed = 0;
  let skipped = 0;

  for (const p of products) {
    const label = `#${p.token_id} ${p.title}`;

    if (!FORCE && p.enhanced_description) {
      console.log(`[skip ${label}] already enhanced`);
      skipped++;
      continue;
    }
    if (!p.jpeg_storage_path && !precomputed) {
      console.log(`[skip ${label}] no image`);
      skipped++;
      continue;
    }

    const mode = resolveMerchantMode(p, brand);
    const category = resolveCategory(p, brand);
    console.log(`[analyze ${label}] mode=${mode} category=${category}`);

    try {
      let result;
      if (precomputed) {
        const pre = precomputed.get(p.token_id);
        if (!pre) {
          console.log(`  [skip] no precomputed row for token ${p.token_id}`);
          skipped++;
          continue;
        }
        result = {
          attributes:          pre.attributes,
          enhancedDescription: pre.enhanced_description,
          tokensIn:            0,
          tokensOut:           0,
        };
        console.log(`  [precomputed] using enrichment from ${PRECOMPUTED_PATH}`);
      } else {
        const image = await getImageBase64(p.jpeg_storage_path);
        result = await analyzeProduct(p, image, mode, category);
      }
      totalTokensIn  += result.tokensIn;
      totalTokensOut += result.tokensOut;

      console.log(`  → attributes:`, JSON.stringify(result.attributes).slice(0, 120) + '...');
      console.log(`  → description: ${result.enhancedDescription.slice(0, 140)}...`);
      console.log(`  → tokens: ${result.tokensIn} in / ${result.tokensOut} out`);

      if (!DRY_RUN) {
        // Merge LLM output on top of whatever was already on the row (the
        // brand-mirror auto-seeded fields). LLM does NOT overwrite seeded
        // retail_sku / vendor / tags — we deep-prefer seeded strings.
        const seeded = p.product_attributes ?? {};
        const merged = { ...result.attributes, ...seeded };
        for (const [k, v] of Object.entries(result.attributes)) {
          if (merged[k] == null || merged[k] === '') merged[k] = v;
        }
        // Record the resolved category so future MCP projections / filters
        // can use it without re-running the detector.
        merged.category = category;

        const { error } = await db.from('rrg_submissions').update({
          enhanced_description: result.enhancedDescription,
          product_attributes:   merged,
          enhanced_at:          new Date().toISOString(),
          // Pre-publish guard: flip to visible once we've actually enriched.
          hidden:               false,
        }).eq('id', p.id);
        if (error) {
          console.error(`  ERROR updating DB:`, error.message);
        } else {
          console.log(`  ✓ saved (hidden → false)`);
        }
      }
      processed++;
    } catch (e) {
      console.error(`  FAIL:`, e.message);
    }
    console.log();
  }

  // Cost estimate: claude-sonnet-4-5 is ~$3/M input, $15/M output
  const estCost = (totalTokensIn * 3 + totalTokensOut * 15) / 1_000_000;

  console.log(`──── Done ────`);
  console.log(`Processed: ${processed} | Skipped: ${skipped}`);
  console.log(`Tokens: ${totalTokensIn} in / ${totalTokensOut} out`);
  console.log(`Est. cost: $${estCost.toFixed(4)}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
