/**
 * scripts/seller-agent.mjs
 *
 * The SELLER side of the VIA exchange. Each entry in ROSTER is one real, onboarded
 * seller; this process runs a reference agent for each, reasoning ONLY over that
 * seller's own stock. It is NOT the old platform proxy: it is bounded to onboarded
 * sellers, one decision per seller over its own catalogue, and any seller can lift
 * its entry out and run it themselves.
 *
 * The seller's journey (from the plan), per seller, per broadcast brief:
 *   1. Watch the broadcast , poll the public demand feed for teasers. No LLM.
 *   2. Open the full brief at the door (GET). (Phase 4 adds the micro-fee here.)
 *   3. Look at ITS OWN stock and decide, with its OWN LLM (one call), what is worth
 *      offering , generous but honest.
 *   4. Submit each offer to the door (POST). The buyer's agent ranks what arrives.
 *
 * Run on a host with an LLM key + the seller wallet secrets (the VPS, alongside
 * RRG; previously the Box). Loop it on a timer to keep responding to new
 * broadcasts. Offers are idempotent server side, so re-polling never duplicates.
 *
 * Env:
 *   DEEPSEEK_API_KEY  (required) the seller's own LLM key.
 *   AGENT_WALLET_SEED (required for the 3 VIA sellers) platform seed; their agent
 *                     wallets are derived in-memory, never stored on disk.
 *   <SLUG>_WALLET_PRIVATE_KEY (one per RRG brand seller, e.g.
 *                     GUMBALL_3000_WALLET_PRIVATE_KEY) that brand's payer key.
 *   VIA_BASE, RRG_BASE  optional base-url overrides (defaults are prod).
 *   VIA_AGENT_DRY_RUN=1  resolve keys + self-select but pay nothing (host smoke test).
 * A seller whose key is not resolvable on this host is simply skipped.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ethers } from 'ethers';

const VIA_BASE = (process.env.VIA_BASE || 'https://app.getvia.xyz').replace(/\/$/, '');
const RRG_BASE = (process.env.RRG_BASE || 'https://realrealgenuine.com').replace(/\/$/, '');
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_NETWORK = 'base'; // x402 friendly network name for Base mainnet

// Offer policy. Every offer costs a micro-fee, so the seller shows its best few,
// not everything that vaguely fits. If MORE genuine fits remain, it invites the
// buyer to give direction (one negotiate call, which costs the BUYER credits) and
// then offers up to a few MORE matching that direction , each still a paid offer.
const MIN_OFFER_SCORE = 60;       // only offer items the seller genuinely backs for THIS brief
const MAX_INITIAL_OFFERS = 3;     // best 3 up front
const MAX_FOLLOWUP_OFFERS = 3;    // at most this many more after the buyer steers

if (!DEEPSEEK_KEY) { console.error('DEEPSEEK_API_KEY required (the seller\'s own LLM key)'); process.exit(1); }

// Per-seller x402 signing material is resolved at RUNTIME, never read from disk:
//  - VIA platform sellers: the agent wallet is DERIVED in-memory from the one
//    platform seed (AGENT_WALLET_SEED) + the store id, the same HMAC the app uses
//    (lib/app/agent-wallet.ts). No key is stored at rest; the only secret is the seed.
//  - RRG brand sellers: the brand's payer key is read from a named env var
//    (<SLUG>_WALLET_PRIVATE_KEY), supplied by the host env (.env.local on the VPS).
// A seller whose key cannot be resolved (seed absent / env var unset) simply cannot
// pay and is skipped, so the roster degrades gracefully as keys are added.
const DRY_RUN = process.env.VIA_AGENT_DRY_RUN === '1' || process.env.VIA_AGENT_DRY_RUN === 'true';

// Same derivation as lib/app/agent-wallet.ts: HMAC-SHA256(seed, "agent-wallet|<id>|<i>"),
// first counter that yields a valid secp256k1 key. Returns an ethers.Wallet or null.
function deriveAgentWallet(storeId) {
  const seed = process.env.AGENT_WALLET_SEED;
  if (!seed) return null;
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', seed).update(`agent-wallet|${storeId}|${i}`).digest('hex');
    try { return new ethers.Wallet(pk); } catch { /* out of curve order, try next */ }
  }
  return null;
}

// Resolve { privkey, erc8004_id } for one roster seller, or null if its key is not
// available on this host. VIA = derive from the seed; RRG = read the named env var.
function keyFor(seller) {
  if (seller.source === 'via') {
    const w = deriveAgentWallet(seller.store_id);
    if (!w) return null; // AGENT_WALLET_SEED not set, or derivation failed
    if (seller.expect && w.address.toLowerCase() !== seller.expect.toLowerCase()) {
      console.error(`[${seller.slug}] derived ${w.address} but on record is ${seller.expect} - wrong AGENT_WALLET_SEED; skipping`);
      return null; // fail-closed: never pay from an unexpected wallet
    }
    return { privkey: w.privateKey, erc8004_id: seller.erc8004_id };
  }
  const pk = process.env[seller.env_key];
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk.trim())) return null; // no/!valid brand key in env
  return { privkey: pk.trim(), erc8004_id: seller.erc8004_id };
}

// The onboarded sellers this process runs an agent for. ONE source of truth: each
// entry carries everything needed to run + pay for that seller, so adding a partner
// is a single line here (DB-driven roster is the next step; see the transfer brief).
//   source     - 'via' (catalogue on app.getvia.xyz, MCP /sellers/<slug>/mcp) or
//                'rrg' (catalogue on realrealgenuine.com, MCP /brand/<slug>/mcp).
//   erc8004_id - on-chain identity id stamped onto each offer.
//   VIA only:  store_id (derivation input) + expect (on-record agent wallet, self-check).
//   RRG only:  env_key  (the named env var holding that brand's payer private key).
// Verified against app_sellers + scripts/place-seller-keys.mjs, 2026-06-16.
const ROSTER = [
  { slug: 'drhobbs-knowledge',       name: 'DrHobbs Knowledge',       source: 'via', erc8004_id: '55552', store_id: 'dd0e81fd-586b-4196-99f3-5f3ed2974ad6', expect: '0x35bcf708834d1c38187a49705dfd7997b551d418' },
  { slug: 'eli-s-artisan-bakery',    name: "Eli's Artisan Bakery",    source: 'via', erc8004_id: '55593', store_id: 'e6a32d65-c452-4e07-9393-4fd4c8e8fd6e', expect: '0xca11b205de3e4f52cc9b6ba4be1276a88b7cc33f' },
  { slug: 'the-sentient-startup',    name: 'The Sentient Startup',    source: 'via', erc8004_id: '55594', store_id: '0296cc76-6e88-4459-b978-aea036a893d7', expect: '0xbfa26fba52fe8bd4d2dd28a25f85220cd5e5b3bc' },
  { slug: 'clooudie',                name: 'Clooudie',                source: 'rrg', erc8004_id: '45691', env_key: 'CLOOUDIE_WALLET_PRIVATE_KEY' },
  { slug: 'nolo',                    name: 'Nolo',                    source: 'rrg', erc8004_id: '45690', env_key: 'NOLO_WALLET_PRIVATE_KEY' },
  { slug: 'jennys',                  name: "Jenny's",                 source: 'rrg', erc8004_id: '55583', env_key: 'JENNYS_WALLET_PRIVATE_KEY' },
  { slug: 'unknown-union',           name: 'Unknown Union',           source: 'rrg', erc8004_id: '44897', env_key: 'UNKNOWN_UNION_WALLET_PRIVATE_KEY' },
  { slug: 'tyo',                     name: 'The Year Of...',          source: 'rrg', erc8004_id: '47353', env_key: 'TYO_WALLET_PRIVATE_KEY' },
  { slug: 'university-of-diversity', name: 'University of Diversity', source: 'rrg', erc8004_id: '47320', env_key: 'UNIVERSITY_OF_DIVERSITY_WALLET_PRIVATE_KEY' },
  { slug: 'les-basics',              name: 'LES BASICS',              source: 'rrg', erc8004_id: '51037', env_key: 'LES_BASICS_WALLET_PRIVATE_KEY' },
  { slug: 'frey-tailored',           name: 'Frey Tailored',           source: 'rrg', erc8004_id: '45686', env_key: 'FREY_TAILORED_WALLET_PRIVATE_KEY' },
  { slug: 'gumball-3000',            name: 'Gumball 3000',            source: 'rrg', erc8004_id: '51174', env_key: 'GUMBALL_3000_WALLET_PRIVATE_KEY' },
  { slug: 'livvium',                 name: 'LIVVIUM',                 source: 'rrg', erc8004_id: '55582', env_key: 'LIVVIUM_WALLET_PRIVATE_KEY' },
  { slug: 'philleywood',             name: 'Philleywood',             source: 'rrg', erc8004_id: '50992', env_key: 'PHILLEYWOOD_WALLET_PRIVATE_KEY' },
  { slug: 'pitchers-only',           name: 'Pitchers Only',           source: 'rrg', erc8004_id: '54261', env_key: 'PITCHERS_ONLY_WALLET_PRIVATE_KEY' },
  // Demo sellers (temporary, until formally onboarded). VIA = ingested vinyl
  // stores enabled via /api/admin/sellers/<id>/enable-agent (2026-06-18); RRG =
  // signer EOA minted by rrg/scripts/register-brand-agent.mjs.
  { slug: 'dear-vinyl',              name: 'Dear Vinyl',              source: 'via', erc8004_id: '55674', store_id: '617374b8-3724-49cd-9f93-2340926df960', expect: '0x5e912d07a3b3b2a2515df8a78c700f5bba737e3e' },
  { slug: 'recycle-vinyl',           name: 'Recycle Vinyl',           source: 'via', erc8004_id: '55675', store_id: '5d48521a-5bd2-4d0c-aab0-cfb885106fe9', expect: '0xac9daccd67e09cc12471572244d2c0f11f07ad0b' },
  { slug: 'snow-records',            name: 'Snow Records Japan',      source: 'via', erc8004_id: '55676', store_id: '7518f06d-1c46-4afb-a009-e0841272d81e', expect: '0x916fd056f096475d2c69e2f9e5af2eb3ffa6dce1' },
  { slug: 'vinyleers',               name: 'Vinyleers',               source: 'via', erc8004_id: '55677', store_id: 'f227563f-cac5-45c8-8f66-92466b19a9f8', expect: '0x4a1a393c8def1bb520743cfd9656f1774bf84abf' },
  { slug: 'americanrag',             name: 'American Rag Cie',        source: 'rrg', erc8004_id: '55678', env_key: 'AMERICANRAG_WALLET_PRIVATE_KEY' },
  { slug: 'standard-and-strange',    name: 'Standard & Strange',      source: 'rrg', erc8004_id: '55679', env_key: 'STANDARD_AND_STRANGE_WALLET_PRIVATE_KEY' },
];

const catalogBase = (source) => (source === 'via' ? VIA_BASE : RRG_BASE);

// The seller's OWN MCP endpoint: VIA = /sellers/<slug>/mcp, RRG = /brand/<slug>/mcp.
const sellerMcpUrl = (seller) =>
  `${catalogBase(seller.source)}/${seller.source === 'via' ? 'sellers' : 'brand'}/${encodeURIComponent(seller.slug)}/mcp`;

/**
 * Call a tool on a seller's MCP server over HTTP. These are stateless MCP
 * (Streamable HTTP, no session) , a single JSON-RPC POST with no initialize
 * handshake is accepted, and the result comes back SSE-framed. Same shape the
 * platform's own MCP QA runner uses. Returns the parsed tool payload, or null.
 */
async function callSellerMcp(mcpUrl, name, args) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args ?? {} } }),
    // Generous: list_products overlays LIVE Shopify stock, so a big catalogue
    // (e.g. Unknown Union ~10s standalone) is slow, and slower again under load.
    signal: AbortSignal.timeout(45000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const text = await res.text();
  const m = text.match(/data: (\{[\s\S]*\})/); // SSE framing; fall back to raw JSON
  let outer;
  try { outer = JSON.parse(m ? m[1] : text); } catch { return null; }
  if (!outer || outer.error) return null;
  const inner = outer.result?.content?.[0]?.text;
  if (typeof inner !== 'string') return null;
  try { return JSON.parse(inner); } catch { return null; }
}

const uniq = (arr) => [...new Set(arr.filter((x) => x !== null && x !== undefined && x !== ''))];

/** Normalise one MCP list_products item (RRG agent-product shape OR VIA shape)
 *  into the candidate the seller's LLM reasons over AND forwards to the buyer's
 *  judge. The `attributes` block is the point: it carries the STRUCTURED facets
 *  (colours, sizes, product_type, tags, SKUs) that answer a buyer's hard
 *  requirements like "black" / "men's", which a bare title never could. */
function toCandidate(p, seller, mcpUrl) {
  if (seller.source === 'via') {
    const tags = Array.isArray(p.tags) && p.tags.length ? p.tags
      : (typeof p.kind === 'string' && p.kind ? [p.kind] : []);
    const attributes = {
      ...(p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes) ? p.attributes : {}),
      ...(typeof p.category === 'string' && p.category ? { category: p.category } : {}),
      ...(tags.length ? { tags } : {}),
    };
    return {
      title: p.title,
      description: typeof p.description === 'string' ? p.description : null,
      tags,
      attributes,
      price_usdc: typeof p.price_usdc === 'number' ? p.price_usdc : null,
      url: p.source_url || null,
      // The VIA product UUID. The door uses it to link the buyer's offer at the
      // canonical buyable product page (/sellers/{slug}/products/{id}).
      product_id: p.product_id || null,
      mcp_url: mcpUrl,
    };
  }
  // RRG agent-product shape (toAgentProduct): full enhanced data on the wire.
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const colors = uniq(variants.map((v) => (v && typeof v.color === 'string' ? v.color : null)));
  const sizes = uniq(variants.map((v) => (v && v.size != null ? String(v.size) : null)));
  const skus = uniq(variants.map((v) => (v && typeof v.sku === 'string' ? v.sku : null))).slice(0, 6);
  const pa = p.productAttributes && typeof p.productAttributes === 'object' ? p.productAttributes : {};
  const productType = typeof pa.product_type === 'string' ? pa.product_type : null;
  const shopifyTags = Array.isArray(pa.shopify_tags) ? pa.shopify_tags : [];
  const attributes = {
    ...(colors.length ? { colors } : {}),
    ...(sizes.length ? { sizes } : {}),
    ...(skus.length ? { skus } : {}),
    ...(productType ? { product_type: productType } : {}),
    ...(shopifyTags.length ? { shopify_tags: shopifyTags } : {}),
    ...(typeof p.category === 'string' && p.category ? { category: p.category } : {}),
    ...(Array.isArray(p.styleTags) && p.styleTags.length ? { style_tags: p.styleTags } : {}),
    ...(Array.isArray(p.occasionFit) && p.occasionFit.length ? { occasion_fit: p.occasionFit } : {}),
  };
  // Also fold the key facets into tags so a tags-only reader still sees colour/type.
  const tags = uniq([
    ...(Array.isArray(p.styleTags) ? p.styleTags : []),
    ...(Array.isArray(p.occasionFit) ? p.occasionFit : []),
    ...colors,
    ...(productType ? [productType] : []),
    ...(typeof p.category === 'string' && p.category ? [p.category] : []),
  ]);
  const price = typeof p.priceUsdc === 'number' ? p.priceUsdc : Number(p.priceUsdc);
  return {
    title: p.title,
    description: typeof p.agentDescription === 'string' && p.agentDescription
      ? p.agentDescription
      : (typeof p.description === 'string' ? p.description : null),
    tags,
    attributes,
    price_usdc: Number.isFinite(price) ? price : null,
    url: p.rrgUrl || p.ecommerceUrl || (p.tokenId != null ? `${RRG_BASE}/rrg/drop/${p.tokenId}` : null),
    mcp_url: mcpUrl,
  };
}

/**
 * Pull THIS seller's OWN stock from its OWN MCP server (`list_products`). The MCP
 * is the enhanced-data product surface , the entire VIA thesis , and its agent
 * visibility is BROADER than the storefront/federation search (e.g. Unknown Union
 * exposes 86 products incl. hoodies via MCP, but only 10 via /api/via/search). The
 * seller hands its whole MCP catalogue to its own LLM, the only matcher. We never
 * read the federation search and filter client-side: that is a thin UI-visible
 * projection and it is the search VIA is not building.
 */
async function ownStock(seller) {
  const mcp = sellerMcpUrl(seller);
  const data = await callSellerMcp(mcp, 'list_products', seller.source === 'via' ? { limit: 250 } : {});
  const rows = Array.isArray(data?.products) ? data.products : [];
  const candidates = rows
    .filter((p) => seller.source === 'via' || p.inStock !== false) // honest offers: skip RRG sold-out stock
    .map((p) => toCandidate(p, seller, mcp))
    .filter((c) => c && typeof c.title === 'string' && c.title.trim());
  // brand_persona: the standard VIA-network identity field (who the brand is,
  // what it makes, who for, the vibe). Every member platform's seller MCP emits
  // it on list_products; the concierge reasons WITH it so it judges a brief as
  // the brand, not from product strings alone. Falls back to the bare name
  // (RRG's `brand` is currently a name string) or the roster name if absent.
  const persona = (typeof data?.brand_persona === 'string' && data.brand_persona.trim())
    ? data.brand_persona.trim()
    : (typeof data?.brand === 'string' && data.brand.trim() ? data.brand.trim() : seller.name);
  // HARD RULE: a brand agent MUST consider EVERY product on its own MCP. No
  // positional cap , the old slice(250) silently dropped the tail of large
  // catalogues (pitchers-only's caps sit at indices 256-273 of 274, so they were
  // cut before the LLM ever saw them). decide() chunks the full set for the LLM,
  // so size is bounded by chunk count, never by dropping products.
  const total = typeof data?.total === 'number' ? data.total : candidates.length;
  return { candidates, persona, total };
}

/** Search a seller's WHOLE catalogue (server-side FTS) for each query string and
 *  return the union of matches as candidates, deduped by product_id. This is how a
 *  large-catalogue seller (e.g. a 27k vinyl store) reaches the items that match a
 *  brief , the agent can never reason over the entire catalogue, so it retrieves
 *  the relevant slice by relevance. VIA only (the per-seller MCP `query` param). */
/** Expand a buyer phrase into recall queries for the strict-AND FTS: the full
 *  phrase PLUS every adjacent word-pair. A leading qualifier the catalogue does
 *  not carry ("early Al Green", "original pressing …") would AND the whole phrase
 *  to zero; the pairs ("Al Green") still hit. Mirrors the buyer matcher's
 *  word/pair recall. Single-word phrases are returned as-is. */
function recallQueries(phrase) {
  if (typeof phrase !== 'string') return [];
  const p = phrase.trim();
  if (!p) return [];
  const toks = p.split(/\s+/).filter((w) => w.length >= 2);
  if (toks.length <= 1) return [p];
  const pairs = [];
  for (let i = 0; i < toks.length - 1; i++) pairs.push(`${toks[i]} ${toks[i + 1]}`);
  return uniq([p, ...pairs]).slice(0, 5);
}

async function searchStock(seller, queries) {
  const mcp = sellerMcpUrl(seller);
  const byId = new Map();
  for (const q of queries) {
    if (!q || !q.trim()) continue;
    const data = await callSellerMcp(mcp, 'list_products', { query: q.trim(), limit: 200 });
    const rows = Array.isArray(data?.products) ? data.products : [];
    for (const p of rows) {
      const c = toCandidate(p, seller, mcp);
      if (c && typeof c.title === 'string' && c.title.trim() && c.product_id) byId.set(c.product_id, c);
    }
  }
  return [...byId.values()].slice(0, 150); // bound the set decide() reasons over
}

/** Decide over ONE chunk of the seller's stock (one LLM call). `i` indexes the chunk. */
async function decideChunk(brief, candidates, sellerName, persona) {
  const list = candidates.map((c, i) => ({ i, title: c.title, description: c.description ? c.description.slice(0, 400) : null, tags: c.tags.slice(0, 12), attributes: c.attributes, price_usdc: c.price_usdc }));
  const sys =
    `You are the Sales Agent for ${sellerName}. This is who your brand is, reason as this brand: "${persona}". ` +
    'A buyer broadcast a brief and you are deciding which items from YOUR OWN stock (the list) genuinely satisfy it. Each offer you make costs a fee, so be honest, not generous. ' +
    'Read the brief to tell which kind it is, and handle each on its own terms. ' +
    '(A) SPECIFIC , it names a product type and/or hard requirements (colour, gender, size, material). Judge each item by what it FUNDAMENTALLY IS , its real product category , never by suggestive words in its title (an item named "Hero\'s Journey Tee" is a t-shirt, and a t-shirt never satisfies a request for a book). Offer only items of the SAME category as the request, including its equivalent forms: a request for a book or reading material is met by books, e-books, reports, papers, guides, documents, essays, or other printed or written matter on the subject (physical or digital); a request for a bag by bags, totes, or packs; and so on , but NEVER by a different category such as apparel, however evocative the name. Within the right category, honour every hard requirement and any specific sub-type the buyer names: a hoodie is NOT satisfied by a sweatshirt, crewneck, or jacket; an olive item is NOT satisfied by a black one. Do not cross categories or stretch to a near-miss , it wastes a paid offer and the buyer rejects it. ' +
    '(B) INTEREST / THEME / GIFT , it names no specific product type, just an interest, occasion, recipient, or theme (e.g. "a gift for someone into rally and cars"). Judge it through your brand identity above: if your brand and catalogue genuinely speak to that interest, offer the items a knowledgeable buyer of YOUR brand would pick for it; if your brand has nothing to do with that interest, offer nothing. This is precise, not generous , the test is real relevance to the stated interest given who your brand is, never "this could be a nice gift". ' +
    'Quality over quantity in both cases: offer only items you would stand behind for THIS brief, respect any budget, and if nothing genuinely fits, offer nothing. ' +
    'For each item you would offer, give a fit score 0-100 (use the full range; reserve 80+ for a strong fit , an exact match on a specific brief, or a clearly on-brand-and-on-interest pick on an interest brief) and a one-line reason to the buyer. Respond as JSON: {"offers":[{"i":<index>,"score":<0-100>,"reason":"<one line>"}]}.';
  const user = JSON.stringify({ brief: { title: brief.title, category: brief.category, looking_for: brief.type_terms, must_haves: brief.requirements, nice_to_haves: brief.preferences, budget_usd: brief.budget_usd }, your_stock: list });
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0, max_tokens: 600, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const content = (await res.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? '{}';
  let parsed;
  try { parsed = JSON.parse(content); } catch { return []; } // a malformed reply skips this seller, never crashes the pass
  const picks = [];
  for (const o of parsed.offers ?? []) {
    const i = typeof o.i === 'number' ? o.i : Number(o.i);
    if (!Number.isInteger(i) || i < 0 || i >= candidates.length) continue;
    picks.push({ i, score: Math.max(0, Math.min(100, Number(o.score) || 0)), reason: String(o.reason || '').slice(0, 300) });
  }
  return picks;
}

/** The seller's OWN decision over ALL its candidates, scored 0-100. A large
 *  catalogue is CHUNKED so EVERY product is reasoned over: a single positional
 *  cap silently dropped the tail and the matching item with it (pitchers-only's
 *  caps sit at indices 256-273 of 274, so its green/olive caps were never seen
 *  and it offered nothing on a cap brief). Picks map back to the full array. */
async function decide(brief, candidates, sellerName, persona) {
  const CHUNK = 80;
  if (candidates.length <= CHUNK) return decideChunk(brief, candidates, sellerName, persona);
  const chunks = [];
  for (let off = 0; off < candidates.length; off += CHUNK) chunks.push({ off, items: candidates.slice(off, off + CHUNK) });
  // Chunks run concurrently so a big catalogue costs ~one LLM round-trip, not N.
  const results = await Promise.all(chunks.map((c) => decideChunk(brief, c.items, sellerName, persona)));
  const out = [];
  results.forEach((picks, ci) => { for (const p of picks) out.push({ ...p, i: p.i + chunks[ci].off }); });
  return out;
}

/** Self-selection on the FREE teaser (category + product type + one attribute):
 *  could this seller plausibly fulfil this demand? Decides whether to pay the
 *  unlock micro-fee at all. One small LLM call over the teaser + a compact view of
 *  the seller's own catalogue. Fail-closed: on any error, do NOT bid (don't pay to
 *  read a brief we are not sure about). */
async function shouldBid(teaser, stock, sellerName, persona) {
  // The gate sees the WHOLE catalogue as two signals: every product NAME, plus the
  // distinct tags/types/categories across the catalogue. Names carry brands and
  // specifics; tags carry the semantic type/topic (so a digital or topical product
  // whose name is a subject, not a form, still matches). Both, deduped, no head-cut.
  const titles = uniq(stock.map((c) => c.title));
  const tagSet = new Set();
  for (const c of stock) {
    if (Array.isArray(c.tags)) for (const t of c.tags) if (typeof t === 'string' && t) tagSet.add(t);
    const a = c.attributes && typeof c.attributes === 'object' ? c.attributes : {};
    for (const v of [a.category, a.product_type]) if (typeof v === 'string' && v) tagSet.add(v);
    for (const k of ['tags', 'style_tags', 'occasion_fit', 'shopify_tags']) if (Array.isArray(a[k])) for (const t of a[k]) if (typeof t === 'string' && t) tagSet.add(t);
  }
  const tags = [...tagSet].slice(0, 80);
  // General, vertical-agnostic self-select. No fixed synonym list: reason from the
  // actual catalogue. Handles a brand/artist/label named in any teaser field, and
  // any kind of merchant (goods, food, music, digital, services). Always decides.
  const sys =
    `You are the autonomous Sales Agent for "${sellerName}". This is who your brand is, reason as this brand: "${persona}". A buyer has broadcast a short, free teaser of what they want. It has up to three fields , a category, a product type, and one attribute , and any of them may be empty, or may name a brand, label, maker, artist, or title instead of a generic word. You are given the COMPLETE list of your product names plus the distinct tags/types across your catalogue. ` +
    'Reading the buyer\'s full brief costs you a fee, so judge from this teaser alone: could you plausibly supply what this buyer wants from your own stock? You MUST return a decision every time, for any kind of request and any kind of catalogue , never refuse to decide. ' +
    'Reason from your ACTUAL catalogue, like a shopkeeper who knows their stock: ' +
    '1) If the request points to a PRODUCT TYPE: judge by the actual KIND of product you stock, not by suggestive words in a product\'s name (a "Hero\'s Journey Tee" is a t-shirt, not a book). Bid YES when your catalogue holds that product or an equivalent form of the SAME category , the same thing under a different word, a sub-type, a variant, or a regional name (judge by meaning, not spelling). A product name often describes its topic, contents, or use rather than its form, so use the tags/types too , reading material counts broadly: a request for a book is met by your books, e-books, reports, papers, guides, documents, essays, or printed/written matter on the subject. Bid NO when you do not stock that KIND of product , a different category never qualifies (apparel does not satisfy a book request), and being in the same broad sector is not enough. ' +
    '2) If the request names a BRAND, label, maker, designer, artist, or title (common , it may appear in ANY field): bid YES only if you ARE that name, or your catalogue actually carries it (it appears among your product names/tags, or is unmistakably part of what you stock). Bid NO if it is a name you do not offer , do not bid YES on a brand you cannot supply just because you sell the same category. ' +
    '3) If only a broad category or attribute is given, with no specific type or brand: bid YES if your catalogue clearly works in that space, NO if you are a different domain. ' +
    'When genuinely unsure, bid YES only if at least one real product of yours could honestly be the answer; otherwise NO. Wasted reads cost money, missed real matches cost sales , weigh both. ' +
    'Respond with JSON only: {"bid": true} or {"bid": false}.';
  const user = JSON.stringify({ teaser: { category: teaser.category, product_type: teaser.product_type, attribute: teaser.attribute }, my_product_names: titles, my_catalogue_tags: tags });
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0, max_tokens: 20, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!res || !res.ok) return false; // fail-closed: don't pay if we couldn't decide
  try { const j = JSON.parse((await res.json())?.choices?.[0]?.message?.content ?? '{}'); return j.bid === true; }
  catch { return false; }
}

// ── x402 client: pay the door's micro-fee from the SELLER's own wallet ────────
// True x402: the seller signs an EIP-3009 transferWithAuthorization (gasless), the
// door's CDP facilitator verifies + settles it on-chain and SPONSORS the gas. The
// seller holds only USDC, never ETH; we never pay or sign a settlement tx.
const TRANSFER_AUTH_TYPES = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] };

/** Build a base64 X-PAYMENT header for one x402 PaymentRequirements `req`
 *  (the 402 body's accepts entry), signing an EIP-3009 authorization. Offline. */
async function buildXPayment(privkey, req) {
  const wallet = new ethers.Wallet(privkey);
  const value = BigInt(req.maxAmountRequired);
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + (Number(req.maxTimeoutSeconds) || 300));
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const domain = { name: req.extra?.name || 'USD Coin', version: req.extra?.version || '2', chainId: 8453, verifyingContract: req.asset };
  const signature = await wallet.signTypedData(domain, TRANSFER_AUTH_TYPES,
    { from: wallet.address, to: req.payTo, value, validAfter, validBefore, nonce });
  const payload = { x402Version: 1, scheme: 'exact', network: req.network, payload: { signature, authorization: {
    from: wallet.address, to: req.payTo, value: value.toString(), validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce,
  } } };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** Fetch a door endpoint; on a 402, sign an EIP-3009 authorization with the
 *  seller's key and retry with the X-PAYMENT header. */
async function payWithX402(url, options, privkey) {
  const first = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!first) return { ok: false, status: null, body: null };
  if (first.status !== 402) { const body = await first.text().catch(() => ''); return { ok: first.ok, status: first.status, body }; }
  let chal = null;
  try { chal = JSON.parse(await first.text()); } catch { return { ok: false, status: 402, body: 'no x402 challenge' }; }
  const req = Array.isArray(chal?.accepts)
    ? chal.accepts.find((a) => a.scheme === 'exact' && a.network === BASE_NETWORK && String(a.asset).toLowerCase() === USDC_ADDRESS.toLowerCase())
    : null;
  if (!req) return { ok: false, status: 402, body: 'no base-usdc exact option' };
  if (Number(BigInt(req.maxAmountRequired)) / 1e6 > 0.01) return { ok: false, status: 402, body: 'over $0.01 safety cap' };
  let xpay;
  try { xpay = await buildXPayment(privkey, req); } catch (e) { return { ok: false, status: 402, body: 'sign failed: ' + e.message }; }
  const retry = await fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-PAYMENT': xpay }, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!retry) return { ok: false, status: null, body: null };
  const body = await retry.text().catch(() => '');
  return { ok: retry.ok, status: retry.status, body, paid: Number(BigInt(req.maxAmountRequired)) / 1e6 };
}

/** Submit one paid offer. Returns { ok, txHash } , the settlement tx is the
 *  seller's ticket to negotiate/ask the buyer for more direction afterwards. */
async function postOffer(doorUrl, seller, p, key) {
  const body = JSON.stringify({ title: p.title, description: p.description, price_usdc: p.price_usdc, url: p.url, product_id: p.product_id ?? null, seller_mcp_url: p.mcp_url, seller_slug: seller.slug, seller_name: seller.name, tags: p.tags, attributes: p.attributes, seller_erc8004_id: key.erc8004_id ?? null });
  const res = await payWithX402(`${doorUrl}/offer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, key.privkey);
  let txHash = null;
  try { txHash = JSON.parse(res.body)?.payment_tx ?? null; } catch { /* non-JSON body */ }
  return { ok: res.ok, txHash };
}

/** Post-door, paid-offer-gated: tell the buyer's agent we have more and ask for
 *  direction. Returns the buyer agent's reply text, or null. Best-effort , any
 *  failure (transport, no reply) just skips the follow-up. Costs the BUYER
 *  credits, so it is called at most once per brief, only when more genuine fits
 *  remain. buyerMcpUrl + the paid offer's txHash come from the unlocked brief. */
async function askForDirection(buyerMcpUrl, briefId, paymentTxHash, message) {
  if (!buyerMcpUrl || !paymentTxHash) return null;
  const out = await callSellerMcp(buyerMcpUrl, 'negotiate', { brief_id: briefId, payment_tx_hash: paymentTxHash, offer_text: message });
  const reply = out && typeof out.reply === 'string' ? out.reply.trim() : null;
  return reply || null;
}

// Watermark: the newest broadcast_at this agent has already processed. Each pass
// asks the feed only for briefs (re)broadcast AFTER it, so we react to NEW
// broadcasts once, never re-scanning all open demand every pass. First run (no
// watermark) catches up on everything, then steady-state passes are tiny.
const WATERMARK_FILE = path.join(os.homedir(), '.via-seller-agent-watermark');
const readWatermark = () => { try { return fs.readFileSync(WATERMARK_FILE, 'utf8').trim() || null; } catch { return null; } };
const writeWatermark = (ts) => { try { fs.writeFileSync(WATERMARK_FILE, ts); } catch (e) { console.error('[seller-agents] watermark write failed:', e.message); } };

async function run() {
  const since = readWatermark();
  const url = `${VIA_BASE}/api/via/demand?limit=50` + (since ? `&since=${encodeURIComponent(since)}` : '');
  const feedRes = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!feedRes || !feedRes.ok) { console.error('[seller-agents] feed unreachable'); return; }
  const teasers = (await feedRes.json()).teasers ?? [];
  console.log(`[seller-agents] ${teasers.length} new teaser(s) since ${since ?? 'start'}; ${ROSTER.length} sellers`);
  if (teasers.length === 0) { console.log('[seller-agents] no new broadcasts , nothing to do'); return; }

  // Each seller's catalogue is brief-independent, so pull every roster seller's
  // own MCP catalogue ONCE per pass, then reason it against each new brief. Fetch
  // in small concurrent batches, NOT all at once: list_products overlays live
  // Shopify stock and 13 simultaneous calls stress the catalogue host's DB pool.
  const stockBySlug = new Map();
  const personaBySlug = new Map();
  const BATCH = 4;
  for (let i = 0; i < ROSTER.length; i += BATCH) {
    const batch = ROSTER.slice(i, i + BATCH);
    const got = await Promise.all(batch.map(async (s) => [s.slug, await ownStock(s)]));
    for (const [slug, r] of got) { stockBySlug.set(slug, r.candidates); personaBySlug.set(slug, r.persona); }
  }
  for (const s of ROSTER) console.log(`[${s.slug}] ${(stockBySlug.get(s.slug) ?? []).length} item(s) in own MCP catalogue`);

  let offers = 0;
  for (const t of teasers) {
    for (const seller of ROSTER) {
      const key = keyFor(seller);
      if (!key) continue; // no resolvable wallet key on this host , this seller cannot pay, skip
      const persona = personaBySlug.get(seller.slug) ?? seller.name;
      const loaded = stockBySlug.get(seller.slug) ?? [];
      // A large VIA catalogue (e.g. vinyl, 6k-27k) cannot be reasoned over in full,
      // so the agent SEARCHES its own catalogue for the brief's terms instead of a
      // newest-N window. "Large" = the browse slice hit the cap (more exist) OR came
      // back empty (a big catalogue whose browse timed out). A genuinely tiny VIA
      // catalogue (a few items, fully loaded) keeps the load-everything + LLM path.
      const isLargeVia = seller.source === 'via' && (loaded.length >= 250 || loaded.length === 0);

      // 0. SELF-SELECT on the FREE teaser before paying anything: the teaser IS the
      // filter. Only a seller that believes it could fulfil this demand pays to
      // unlock. Large VIA self-selects by searching its whole catalogue for the
      // teaser's specific signal (so a vinyl store with no Fatboy Slim records skips
      // and pays nothing); others judge as their brand (persona) over loaded stock.
      let selfHits = null;
      if (isLargeVia) {
        const selfQs = recallQueries((t.attribute && t.attribute.trim()) || (t.product_type && t.product_type.trim()) || '');
        selfHits = selfQs.length ? await searchStock(seller, selfQs) : [];
        if (selfHits.length === 0) { console.log(`[${seller.slug}] teaser not relevant , skipped (no unlock fee)`); continue; }
      } else {
        if (loaded.length === 0) continue; // empty catalogue , nothing to offer
        if (!(await shouldBid(t, loaded, seller.name, persona))) {
          console.log(`[${seller.slug}] teaser not relevant , skipped (no unlock fee)`);
          continue;
        }
      }

      // Dry-run smoke test (VIA_AGENT_DRY_RUN): the key resolved and the seller
      // would bid, but pay NOTHING. Lets a new host (the VPS) be verified end to
      // end without spending while the live host keeps running. No offers persist.
      if (DRY_RUN) {
        console.log(`[${seller.slug}] [dry-run] key OK + would unlock/decide on brief ${t.brief_id} (no payment)`);
        continue;
      }

      // 1. PAY the micro-fee to unlock the FULL brief at the door (per seller).
      const unlock = await payWithX402(t.door_url, { method: 'GET' }, key.privkey);
      if (!unlock.ok) { console.log(`[${seller.slug}] unlock failed (${unlock.status}): ${String(unlock.body).slice(0, 80)}`); continue; }
      let brief = null, buyerMcpUrl = null;
      try { const u = JSON.parse(unlock.body); brief = u.brief ?? null; buyerMcpUrl = u.buyer_mcp_url ?? null; } catch { /* bad body */ }
      if (!brief) continue;

      // Candidate set for the decision: large VIA searches the whole catalogue with
      // the full brief's specific terms (teaser attribute + hard requirements);
      // everyone else reasons over the fully-loaded catalogue.
      let stock;
      if (isLargeVia) {
        const dqFields = [t.attribute, ...(Array.isArray(brief.requirements) ? brief.requirements : [])].filter((x) => typeof x === 'string' && x.trim());
        const dq = uniq(dqFields.flatMap(recallQueries)).slice(0, 6);
        stock = dq.length ? await searchStock(seller, dq) : selfHits;
        if (stock.length === 0) { console.log(`[${seller.slug}] unlocked brief ${t.brief_id}, catalogue search found nothing , no offer`); continue; }
      } else {
        stock = loaded;
      }

      // 2. Decide over the candidate stock; keep only genuine fits, best first.
      const ranked = (await decide(brief, stock, seller.name, persona))
        .filter((pk) => pk.score >= MIN_OFFER_SCORE)
        .sort((a, b) => b.score - a.score);
      if (ranked.length === 0) { console.log(`[${seller.slug}] unlocked brief ${t.brief_id}, nothing genuinely fits , no offer`); continue; }

      // 3. Offer the best few (capped). Each is a paid offer; hold the rest back.
      let lastTx = null;
      for (const pick of ranked.slice(0, MAX_INITIAL_OFFERS)) {
        const p = stock[pick.i];
        if (!p) continue;
        const r = await postOffer(t.door_url, seller, p, key);
        if (r.ok) { offers++; lastTx = r.txHash ?? lastTx; console.log(`[${seller.slug}] paid + offered "${p.title}" (score ${pick.score}) on brief ${t.brief_id}`); }
      }

      // 4. More genuine fits than we showed? Tell the buyer and invite direction
      // ONCE (costs the buyer credits), then offer up to a few MORE matching the
      // reply , each still a paid offer the seller weighs against the response.
      const held = ranked.slice(MAX_INITIAL_OFFERS);
      if (held.length > 0 && lastTx && buyerMcpUrl) {
        const msg = `We have ${held.length} more item(s) in stock you might like. If you would like more options, help us by giving a little more direction on what you would prefer to see , style, colour, budget, or use.`;
        const reply = await askForDirection(buyerMcpUrl, t.brief_id, lastTx, msg);
        if (!reply) {
          console.log(`[${seller.slug}] offered ${Math.min(ranked.length, MAX_INITIAL_OFFERS)}, invited more direction; no reply , holding ${held.length} back`);
        } else {
          const heldStock = held.map((h) => stock[h.i]).filter(Boolean);
          const refined = (await decide({ ...brief, requirements: [...(brief.requirements ?? []), reply] }, heldStock, seller.name, persona))
            .filter((pk) => pk.score >= MIN_OFFER_SCORE)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_FOLLOWUP_OFFERS);
          for (const pick of refined) {
            const p = heldStock[pick.i];
            if (!p) continue;
            const r = await postOffer(t.door_url, seller, p, key);
            if (r.ok) { offers++; console.log(`[${seller.slug}] follow-up offer "${p.title}" (score ${pick.score}) after buyer direction`); }
          }
        }
      }
    }
  }
  // Advance the watermark to the newest broadcast we just handled, so the next
  // pass starts after it. Re-broadcasts (a buyer agent bumping broadcast_at) sort
  // newer than the watermark, so they are picked up again , exactly as intended.
  let maxTs = since;
  for (const t of teasers) { if (t.broadcast_at && (!maxTs || t.broadcast_at > maxTs)) maxTs = t.broadcast_at; }
  if (maxTs && maxTs !== since) writeWatermark(maxTs);
  console.log(`[seller-agents] done , ${offers} offer(s) submitted; watermark=${maxTs ?? 'none'}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
