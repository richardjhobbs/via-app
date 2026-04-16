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
const SYSTEM_PROMPT = `You are a product data writer for Real Real Genuine, an agent-facing commerce platform.

You will be given:
1. An image of a garment (usually flat-lay or mannequin)
2. The brand's original conceptual description (often abstract/thematic)
3. The product title
4. The sizing category (tops | bottoms | outerwear | skirts)

Your job:
A) Extract STRUCTURED attributes from the image (for agent filtering)
B) Rewrite the description for agent consumption: preserves brand voice and concept
   but adds physical specifics (fabric guess, fit, silhouette, graphic details).
   3-5 sentences. No sizing advice (that's a separate chart). No invented facts.

Return strict JSON (no prose around it):
{
  "attributes": {
    "fabric_guess":     "material best guess (e.g. 'midweight cotton jersey', 'heavyweight wool/cotton knit')",
    "fit":              "slim | regular | relaxed | oversized | boxy",
    "silhouette":       "concrete shape (e.g. 'crew-neck short-sleeve boxy tee')",
    "primary_color":    "dominant color word",
    "secondary_colors": ["accent colors"],
    "graphic_details":  "printed/embroidered graphics visible + approximate position",
    "construction":     "visible construction details (seams, hems, trim, closures, reinforcement, labels)",
    "styling_hints":    "how the garment might pair or layer"
  },
  "enhanced_description": "3-5 sentences preserving brand voice and weaving in the physical details."
}`;

// ── Helpers ──────────────────────────────────────────────────────────

async function getBrand() {
  const { data } = await db.from('rrg_brands').select('*').eq('slug', BRAND_SLUG).single();
  if (!data) { console.error(`Brand not found: ${BRAND_SLUG}`); process.exit(1); }
  return data;
}

async function getProducts(brandId) {
  let query = db
    .from('rrg_submissions')
    .select('id, token_id, title, description, enhanced_description, jpeg_storage_path')
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

async function analyzeProduct(product, image) {
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

Analyze the image and return the JSON structure specified in the system prompt.`,
    },
  ];

  const resp = await anthropic.messages.create({
    model:       'claude-sonnet-4-5',
    max_tokens:  1500,
    system:      SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userContent }],
  });

  // Extract JSON from response
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

    console.log(`[analyze ${label}]`);

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
        result = await analyzeProduct(p, image);
      }
      totalTokensIn  += result.tokensIn;
      totalTokensOut += result.tokensOut;

      console.log(`  → attributes:`, JSON.stringify(result.attributes).slice(0, 120) + '...');
      console.log(`  → description: ${result.enhancedDescription.slice(0, 140)}...`);
      console.log(`  → tokens: ${result.tokensIn} in / ${result.tokensOut} out`);

      if (!DRY_RUN) {
        const { error } = await db.from('rrg_submissions').update({
          enhanced_description: result.enhancedDescription,
          product_attributes:   result.attributes,
          enhanced_at:          new Date().toISOString(),
        }).eq('id', p.id);
        if (error) {
          console.error(`  ERROR updating DB:`, error.message);
        } else {
          console.log(`  ✓ saved`);
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
