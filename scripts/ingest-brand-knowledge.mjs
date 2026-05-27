/**
 * scripts/ingest-brand-knowledge.mjs
 *
 * Knowledge-base ingest for a brand's Brand Concierge.
 *
 * Crawls policy/page URLs on the brand's public site (Shopify pattern by
 * default), strips chrome to body text, sends each page to Claude Sonnet
 * 4.5 for structured extraction, and writes the result to rrg_brand_memories
 * with source='import'. Re-runs are idempotent: prior memories with the same
 * structured.source_url get expired (active=false, valid_until=now()) before
 * the new ones land, so a brand's policies can be re-pulled cleanly.
 *
 * Mirrors the patterns in scripts/enhance-descriptions.mjs (env loading,
 * Anthropic SDK, Supabase service client) and scripts/fetch-brand-images.mjs
 * (native fetch with the RRG-Onboarder UA, regex HTML cleanup, no scraping
 * libs).
 *
 * Usage:
 *   node scripts/ingest-brand-knowledge.mjs --brand standard-and-strange
 *   node scripts/ingest-brand-knowledge.mjs --brand standard-and-strange --commit
 *   node scripts/ingest-brand-knowledge.mjs --brand standard-and-strange --only /policies/refund-policy
 *
 *   # Precomputed path,  feed a JSON file of pre-extracted entries (skips the
 *   # crawl + LLM call entirely). Mirror of enhance-descriptions.mjs's
 *   # precomputed flow. Entries shape:
 *   #   [
 *   #     {
 *   #       "source_url": "https://...",
 *   #       "entries": [
 *   #         { "type": "policy"|"general", "title": "...", "body": "...",
 *   #           "tags": ["..."], "structured": {...},
 *   #           "confirmed_summary": "Locked in: ..." }
 *   #       ]
 *   #     }
 *   #   ]
 *   node scripts/ingest-brand-knowledge.mjs --brand standard-and-strange \
 *     --use-precomputed tmp/sas-knowledge.json --commit
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
const COMMIT           = args.includes('--commit');
const ONLY_PATH        = flag('--only');
const PRECOMPUTED_PATH = flag('--use-precomputed');

if (!BRAND_SLUG) {
  console.error('Usage: node scripts/ingest-brand-knowledge.mjs --brand <slug> [--commit] [--only /path] [--use-precomputed <file>]');
  process.exit(1);
}
if (!PRECOMPUTED_PATH && !ANTHROPIC_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY or CLAUDE_API_KEY required (or pass --use-precomputed <file>)');
  process.exit(1);
}

const db        = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

const USER_AGENT = 'Mozilla/5.0 (compatible; RRG-Onboarder/1.0; +https://realrealgenuine.com)';

// ── Canonical Shopify knowledge URLs ─────────────────────────────────
const CANONICAL_PATHS = [
  '/policies/refund-policy',
  '/policies/shipping-policy',
  '/policies/privacy-policy',
  '/policies/terms-of-service',
  '/policies/legal-notice',
  '/pages/returns',
  '/pages/return-policy',
  '/pages/shipping',
  '/pages/shipping-info',
  '/pages/faq',
  '/pages/faqs',
  '/pages/size-guide',
  '/pages/sizing',
  '/pages/about',
  '/pages/about-us',
  '/pages/contact',
  '/pages/care',
  '/pages/care-guide',
];

const PAGE_SLUG_REGEX = /(return|ship|size|fit|measur|faq|care|about|policy|guide|terms|warrant)/i;

// ── HTTP helpers ─────────────────────────────────────────────────────

async function tryFetch(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml' }, redirect: 'follow' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    return { body, contentType: ct };
  } catch (err) {
    console.warn(`  [fetch] ${url} failed: ${err.message}`);
    return null;
  }
}

// ── HTML → readable text ─────────────────────────────────────────────

function cleanHtml(html) {
  let s = html;
  // Drop scripts/styles entirely
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // Drop common chrome
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<header[\s\S]*?<\/header>/gi, ' ');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  // Keep headings + paragraphs + lists + tables as plain text with separators
  s = s.replace(/<\/(h[1-6]|p|li|tr|div|section)>/gi, '\n');
  s = s.replace(/<br\s*\/?\s*>/gi, '\n');
  // Strip all remaining tags
  s = s.replace(/<[^>]+>/g, '');
  // Decode a few common entities
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

// ── Sitemap discovery (Shopify standard) ─────────────────────────────

async function discoverFromSitemap(origin) {
  const candidates = [`${origin}/sitemap_pages_1.xml`, `${origin}/sitemap.xml`];
  const urls = new Set();
  for (const sm of candidates) {
    const r = await tryFetch(sm);
    if (!r) continue;
    const matches = r.body.match(/<loc>[^<]+<\/loc>/g) || [];
    for (const m of matches) {
      const u = m.replace(/^<loc>/, '').replace(/<\/loc>$/, '').trim();
      if (!u.startsWith(origin)) continue;
      const path = u.slice(origin.length);
      if (path.startsWith('/pages/') && PAGE_SLUG_REGEX.test(path)) {
        urls.add(path);
      }
    }
  }
  return [...urls];
}

// ── LLM extraction ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You convert a brand's policy / about / FAQ webpage into a structured set of knowledge entries for the brand's Concierge.

Output STRICT JSON: { "entries": [ { ... }, ... ] }.

Each entry has:
- type: one of "policy" | "general". Use "policy" for returns, refunds, exchanges, shipping, warranty, terms, privacy, sizing rules, care rules, payment, fraud. Use "general" for brand story, voice, FAQs that are not policy, contact info.
- title: <= 110 chars, human-readable, includes a section anchor when the source is long, e.g. "Returns,  eligibility", "Sizing,  chest measurement", "Shipping,  international duties".
- body: <= 1800 chars, customer-facing prose in the brand's voice when discernable from the source. Plain text. No markdown headings. No em or en dashes. No emoji.
- tags: array of short kebab-case strings. ALWAYS include the source slug as a tag (e.g. "policy:refund", "page:size-guide"). Add 2-6 topical tags ("returns", "international-shipping", "final-sale", "denim-sizing").
- structured: object with keys you can derive verbatim from the page: { window_days?: int, restocking_fee?: string, exclusions?: string[], regions?: string[], duty_handling?: string, ... }. Omit if nothing structured is present.
- confirmed_summary: one sentence, starts with "Locked in: ", describing what this entry captures.

Rules:
- Never invent. If a number, deadline, or fee isn't on the page, leave it out.
- Split long policies into multiple entries by section/heading rather than producing one wall-of-text body.
- If the page is purely chrome (nav, "search results", a redirect), return { "entries": [] }.
- Do not include sizing TABLES verbatim if they are large; capture the rules ("measure across the chest 2cm below the armpit") and reference the source URL.`;

async function extractEntries({ url, slug, title, text, brandName, brandSlug }) {
  const userPrompt = `Brand: ${brandName} (slug: ${brandSlug})
Source URL: ${url}
Source slug: ${slug}
Page <title>: ${title ?? '(none)'}

Page text (cleaned):
"""
${text.slice(0, 18000)}
"""

Return JSON only. Do not wrap in markdown.`;

  const resp = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 4000,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  const textOut = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = textOut.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`  [extract] no JSON in response for ${url}`);
    return { entries: [], tokensIn: resp.usage.input_tokens, tokensOut: resp.usage.output_tokens };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`  [extract] invalid JSON for ${url}: ${err.message}`);
    return { entries: [], tokensIn: resp.usage.input_tokens, tokensOut: resp.usage.output_tokens };
  }
  return {
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    tokensIn: resp.usage.input_tokens,
    tokensOut: resp.usage.output_tokens,
  };
}

// ── DB writes ────────────────────────────────────────────────────────

async function expirePriorForUrl(brandId, sourceUrl) {
  const { data, error } = await db
    .from('rrg_brand_memories')
    .update({ active: false, valid_until: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('source', 'import')
    .eq('active', true)
    .filter('structured->>source_url', 'eq', sourceUrl)
    .select('id');
  if (error) {
    console.warn(`  [expire] ${sourceUrl}: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}

async function insertEntry(brand, entry, sourceUrl) {
  const type = entry.type === 'general' ? 'general' : 'policy';
  const tags = Array.isArray(entry.tags) ? entry.tags.filter(t => typeof t === 'string' && t.length <= 64).slice(0, 12) : [];
  const structured = {
    ...(entry.structured && typeof entry.structured === 'object' ? entry.structured : {}),
    source_url:  sourceUrl,
    fetched_at:  new Date().toISOString(),
  };
  const row = {
    brand_id:           brand.id,
    brand_slug:         brand.slug,
    type,
    title:              String(entry.title ?? 'Untitled').slice(0, 120),
    body:               String(entry.body ?? '').slice(0, 2000),
    structured,
    tags,
    valid_from:         new Date().toISOString(),
    valid_until:        null,
    confirmed_summary:  entry.confirmed_summary ?? null,
    source:             'import',
    created_by_label:   'ingest-brand-knowledge',
    session_id:         `ingest-${Date.now()}`,
  };
  const { data, error } = await db
    .from('rrg_brand_memories')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    console.warn(`  [insert] ${entry.title}: ${error.message}`);
    return null;
  }
  return data.id;
}

// ── Brand lookup ─────────────────────────────────────────────────────

async function getBrand() {
  const { data, error } = await db
    .from('rrg_brands')
    .select('id, slug, name, website_url, shopify_domain')
    .eq('slug', BRAND_SLUG)
    .single();
  if (error || !data) throw new Error(`Brand not found: ${BRAND_SLUG}`);
  return data;
}

function originFor(brand) {
  const url = brand.website_url || (brand.shopify_domain ? `https://${brand.shopify_domain}` : null);
  if (!url) throw new Error(`No website_url or shopify_domain on brand ${brand.slug}`);
  return url.replace(/\/$/, '');
}

// ── Main ─────────────────────────────────────────────────────────────

(async () => {
  console.log(`──── Ingest brand knowledge: ${BRAND_SLUG} ────`);
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'dry-run'}${ONLY_PATH ? ` | only ${ONLY_PATH}` : ''}`);
  console.log();

  const brand = await getBrand();
  const origin = originFor(brand);
  console.log(`Brand: ${brand.name} (${brand.id})`);
  console.log(`Origin: ${origin}`);
  console.log();

  // ── Precomputed path: skip the crawl + LLM call entirely ────────────
  if (PRECOMPUTED_PATH) {
    const filePath = resolve(process.cwd(), PRECOMPUTED_PATH);
    const arr = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(arr)) throw new Error('precomputed file must be a JSON array');

    let pageCount = 0;
    let inserted = 0;
    let expired = 0;
    for (const page of arr) {
      if (!page.source_url || !Array.isArray(page.entries)) {
        console.warn(`[precomputed] skipping malformed page entry: ${JSON.stringify(page).slice(0, 120)}`);
        continue;
      }
      pageCount++;
      console.log(`\n[precomputed] ${page.source_url},  ${page.entries.length} entries`);
      if (COMMIT) {
        expired += await expirePriorForUrl(brand.id, page.source_url);
        for (const e of page.entries) {
          const id = await insertEntry(brand, e, page.source_url);
          if (id) { inserted++; console.log(`    ✓ ${e.type ?? 'policy'} · ${e.title}`); }
        }
      } else {
        for (const e of page.entries) {
          console.log(`    · [${e.type ?? 'policy'}] ${e.title}`);
          if (e.tags?.length) console.log(`      tags: ${e.tags.join(', ')}`);
          if (e.confirmed_summary) console.log(`      ${e.confirmed_summary}`);
        }
      }
    }

    console.log();
    console.log('──── Summary (precomputed) ────');
    console.log(`Pages: ${pageCount}`);
    if (COMMIT) {
      console.log(`Entries inserted: ${inserted}`);
      console.log(`Prior memories expired: ${expired}`);
    } else {
      console.log(`(dry run,  re-run with --commit to write)`);
    }
    return;
  }

  const paths = ONLY_PATH ? [ONLY_PATH] : CANONICAL_PATHS.slice();

  if (!ONLY_PATH) {
    const discovered = await discoverFromSitemap(origin);
    for (const p of discovered) if (!paths.includes(p)) paths.push(p);
    console.log(`Discovered ${discovered.length} extra page(s) from sitemap.`);
  }

  let pagesHit = 0;
  let entriesEmitted = 0;
  let entriesInserted = 0;
  let priorExpired = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const path of paths) {
    const url = `${origin}${path}`;
    process.stdout.write(`\n[fetch] ${path} ... `);
    const r = await tryFetch(url);
    if (!r) { console.log('skip'); continue; }
    if (!/text\/html/i.test(r.contentType)) { console.log(`skip (ct=${r.contentType})`); continue; }
    const title = extractTitle(r.body);
    const text  = cleanHtml(r.body);
    if (text.length < 200) { console.log(`skip (only ${text.length} chars after cleanup)`); continue; }
    pagesHit++;
    console.log(`ok (${text.length} chars, title="${title ?? ''}")`);

    const slug = path.split('/').pop() || path;
    const { entries, tokensIn, tokensOut } = await extractEntries({
      url, slug, title, text,
      brandName: brand.name,
      brandSlug: brand.slug,
    });
    totalIn += tokensIn; totalOut += tokensOut;
    console.log(`  → ${entries.length} entries (${tokensIn}/${tokensOut} tokens)`);
    entriesEmitted += entries.length;
    if (!entries.length) continue;

    if (COMMIT) {
      priorExpired += await expirePriorForUrl(brand.id, url);
      for (const e of entries) {
        const id = await insertEntry(brand, e, url);
        if (id) { entriesInserted++; console.log(`    ✓ ${e.type ?? 'policy'} · ${e.title}`); }
      }
    } else {
      for (const e of entries) {
        console.log(`    · [${e.type ?? 'policy'}] ${e.title}`);
        if (e.tags?.length) console.log(`      tags: ${e.tags.join(', ')}`);
        if (e.confirmed_summary) console.log(`      ${e.confirmed_summary}`);
      }
    }
  }

  console.log();
  console.log('──── Summary ────');
  console.log(`Pages fetched: ${pagesHit} / ${paths.length}`);
  console.log(`Entries proposed: ${entriesEmitted}`);
  if (COMMIT) {
    console.log(`Entries inserted: ${entriesInserted}`);
    console.log(`Prior memories expired: ${priorExpired}`);
  } else {
    console.log(`(dry run,  re-run with --commit to write)`);
  }
  const cost = (totalIn * 3 + totalOut * 15) / 1_000_000;
  console.log(`Claude tokens: ${totalIn} in, ${totalOut} out (~$${cost.toFixed(4)})`);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
