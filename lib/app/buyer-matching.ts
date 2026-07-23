/**
 * Outbound sourcing loop for buying intents.
 *
 * A buying intent (app_buyer_intents) is inert on its own. This module turns a
 * brief into action: it distils the owner's free-text brief into a structured
 * INTENT (query terms + category + attributes + budget), fuses that with the
 * buyer's training (app_buyer_memories), searches the WHOLE VIA network for it
 * (searchNetwork: local VIA + RRG + every future member), ranks the blended
 * results by how well they match the intent, and writes the best hits into
 * app_buyer_intent_matches. Matches drive the buyer dashboard and notify the
 * owner.
 *
 * Why structured intent, not bare keywords: a denim brief ("Made in japan
 * selvage denim, ideally raw") shares the word "raw" with vinyl titles ("Raw
 * Power"). Plain keyword overlap surfaces the vinyl. The LLM reads the brief and
 * emits the category (apparel/denim) and attributes (selvage, raw, japanese,
 * size) used to RANK, so apparel outranks the lexical collision regardless of
 * which network member returned it. The brief says what-now; the training says
 * how-this-buyer-always-buys; both compound into the query and the ranking. The
 * extracted intent is cached on `structured.search_intent` so the re-match cron
 * does not re-pay for the LLM.
 *
 * Triggers:
 *   - on intent create  (POST /api/buyer/[buyerId]/intents) , immediate
 *   - on the re-match cron (/api/cron/match-intents)         , picks up newly
 *                                                              ingested products
 *
 * Dedup is by (intent_id, product_id): re-running never duplicates a match.
 * product_id is a text snapshot ref (a VIA-app uuid, or a member's product URL).
 */

import { db } from './db';
import { recallNetwork, type UnifiedProduct } from './network-search';
import { relevanceScore } from './via-search';
import { insertNotification } from './notifications';
import { deductCredits, hasCredits } from './buyer-credits';

/**
 * Token accumulator threaded through the matching LLM calls (extract + judge) so
 * the platform DeepSeek spend can be metered against the initiating buyer's
 * credits. The matching path ALWAYS uses the platform key (never the buyer's BYO
 * key), so it always costs the platform and must always be metered when a buyer
 * can be attributed. Anonymous dry-runs pass no meter.
 */
export interface TokenMeter { tokens: number; }

function addUsage(meter: TokenMeter | undefined, json: unknown): void {
  if (!meter) return;
  const u = (json as { usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
  if (!u) return;
  const total = typeof u.total_tokens === 'number'
    ? u.total_tokens
    : (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
  meter.tokens += total;
}

/** Deduct the metered matching tokens from a buyer's credits. Best-effort: a
 *  credit hiccup must never fail a match run (mirrors the chat route). */
async function meterAgainstBuyer(buyerId: string, meter: TokenMeter): Promise<void> {
  if (meter.tokens <= 0) return;
  try {
    await deductCredits(buyerId, meter.tokens, 'brief sourcing');
  } catch (e) {
    console.error('[buyer-matching] credit meter failed:', e);
  }
}

const MATCH_LIMIT = 12;       // max matches written per brief
const RECALL_LOCAL = 30;      // local candidates pulled per recall term
const RECALL_MEMBER = 40;     // member candidates pulled per recall term (members rank brand/attribute hits lower, so fetch deeper)
const JUDGE_LIMIT = 60;       // max candidates sent to the AI judge (interleaved local + member)
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface IntentLite {
  id:          string;
  buyer_id:    string;
  intent_text: string;
  status?:     string;
  structured?: Record<string, unknown> | null;
}

/**
 * A brief distilled into recall terms PLUS the buyer's real intent. The recall
 * fields cast a wide net across the network; the intent fields are what the AI
 * judge enforces so "raw denim" returns ONLY raw denim, not generic denim.
 *   terms        , query strings to fan out across members (broad recall)
 *   category     , the vertical, e.g. "apparel/denim" or "music/vinyl"
 *   type_terms   , product-type nouns + synonyms a title uses (denim -> jean, jeans)
 *   requirements , HARD must-haves. A candidate that fails ANY is excluded.
 *                  e.g. "raw denim", "made in japan", "selvage", "size 34 or 36"
 *   preferences  , soft nice-to-haves that only raise ranking, never exclude.
 *   budget_usd   , a price ceiling if the brief states one.
 */
export interface BriefIntent {
  terms:        string[];
  category:     string | null;
  type_terms:   string[];
  requirements: string[];
  preferences:  string[];
  budget_usd:   number | null;
  /** The single most prominent attribute for the public teaser (colour / price /
   *  location / material). Deliberately thin: enough for a seller to self-select,
   *  not enough to offer well without unlocking the full brief. */
  teaser_attribute: string | null;
}

function asStrings(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is string => typeof t === 'string' && t.trim().length >= 2).map((t) => t.trim()).slice(0, max);
}

/**
 * Distil a conversational brief into a structured BriefIntent. Falls back to the
 * raw brief as a single term when DeepSeek is unconfigured or errors , never
 * throws.
 */
export async function extractIntent(briefText: string, meter?: TokenMeter): Promise<BriefIntent> {
  const raw = briefText.trim();
  const fallback: BriefIntent = { terms: raw ? [raw] : [], category: null, type_terms: [], requirements: [], preferences: [], budget_usd: null, teaser_attribute: null };
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || raw.length < 2) return fallback;

  const systemPrompt =
    'You convert a shopper\'s free-text buying brief into a structured intent for a multi-vertical marketplace. The marketplace sells ANYTHING , apparel, vinyl records, food, restaurant bookings, car parts, furniture, electronics, and more , so do not assume a category; infer it from the brief. ' +
    'Respond as JSON with these keys:\n' +
    '  "terms": 1-3 broad query strings to RECALL candidates (brand, maker, model, or product type). Keep them broad; filtering happens later. Drop filler like "looking for", "in my size".\n' +
    '  "category": the single product vertical as "domain/type", e.g. "apparel/denim", "music/vinyl", "food/bakery", "auto/brakes", "home/furniture". null if unclear.\n' +
    '  "type_terms": product-type nouns AND close synonyms a title uses, lowercase, 1-6 items. Examples across verticals: denim jeans -> ["denim","jean","jeans"]; vinyl -> ["vinyl","lp","record","album"]; sourdough -> ["sourdough","bread","loaf"]; brake pads -> ["brake pad","brake pads","brakes"]. [] if generic.\n' +
    '  "requirements": the HARD must-haves the buyer clearly insists on. A product that fails ANY of these is the WRONG product and must be excluded. Be faithful to the buyer\'s wording across any vertical: "raw denim" means raw not just denim; "made in japan" means Japanese-made; "signed first pressing" means signed AND a first pressing; "gluten free" means gluten free; "OEM brake pads for a 2015 Civic" means OEM and that fitment. ' +
      'CRITICAL , the SUBJECT or TOPIC of an informational product (a document, book, article, essay, report, or a record\'s theme) is NOT a hard requirement. For "a document about web3 and fashion", "a book on stoicism", "an essay on agentic commerce", the subjects (web3, fashion, stoicism, agentic commerce) go in terms/preferences so they RANK, never in requirements , an item that covers the topic, or one facet of it, must not be excluded. Reserve requirements for concrete PRODUCT ATTRIBUTES the buyer insists on: format (digital vs physical), size, material, edition/pressing, label, condition/grade, fitment, certification. A topical "about X and Y" must NEVER become a strict AND that drops an on-topic item covering only X. ' +
      'Phrases like "ideally", "preferably", "if possible" are NOT requirements, they are preferences. Use short noun phrases, [] if none.\n' +
    '  "preferences": soft nice-to-haves that should only raise ranking, never exclude (e.g. things prefixed with "ideally"). [] if none.\n' +
    '  "budget_usd": max price in USD as a number if stated, else null.\n' +
    '  "teaser_attribute": the SINGLE most prominent, distinguishing attribute of this brief as a short phrase (a colour, a price point, a place, a material, a maker), for a public one-line teaser. Pick the one detail a seller would most use to decide if the brief is worth their attention. Keep it under 6 words. null if nothing stands out.';

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: raw },
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      console.warn(`[buyer-matching] DeepSeek extract ${res.status}; falling back to raw brief`);
      return fallback;
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    addUsage(meter, json);
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as { terms?: unknown; category?: unknown; type_terms?: unknown; requirements?: unknown; preferences?: unknown; budget_usd?: unknown; teaser_attribute?: unknown };
    const terms = asStrings(parsed.terms, 3);
    const category = typeof parsed.category === 'string' && parsed.category.trim().length >= 2 ? parsed.category.trim().toLowerCase() : null;
    const type_terms = asStrings(parsed.type_terms, 6).map((a) => a.toLowerCase());
    const requirements = asStrings(parsed.requirements, 8);
    const preferences = asStrings(parsed.preferences, 8);
    const budget_usd = typeof parsed.budget_usd === 'number' && parsed.budget_usd > 0 ? parsed.budget_usd : null;
    const teaser_attribute = typeof parsed.teaser_attribute === 'string' && parsed.teaser_attribute.trim().length >= 2 ? parsed.teaser_attribute.trim().slice(0, 60) : null;
    return { terms: terms.length > 0 ? terms : [raw], category, type_terms, requirements, preferences, budget_usd, teaser_attribute };
  } catch (e) {
    console.warn('[buyer-matching] DeepSeek extract threw; falling back to raw brief:', e);
    return fallback;
  }
}

/**
 * The AI judge: the heart of agentic matching. Reads each candidate's full
 * enriched data (title, brand, description, tags, price) and returns ONLY the
 * products that satisfy EVERY hard requirement, scored by overall fit. This is
 * what turns "raw denim" into raw denim and rejects generic denim, instead of
 * keyword overlap. Returns a map keyed by the caller's candidate key.
 *
 * Never throws: on any error (no key, bad JSON, API down) it returns null so the
 * caller falls back to deterministic scoring rather than dropping all matches.
 */
async function judgeCandidates(
  intentText: string,
  brief: BriefIntent,
  preferredTerms: string[],
  candidates: { key: string; u: UnifiedProduct }[],
  meter?: TokenMeter,
): Promise<Map<string, number> | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || candidates.length === 0) return null;

  const list = candidates.map((c, i) => ({
    i,
    title: c.u.title,
    seller: c.u.seller,
    price_usdc: c.u.price_usdc,
    availability: c.u.detail,   // brand · price · in-stock sizes, for size requirements
    description: c.u.description ? c.u.description.slice(0, 500) : null,
    tags: c.u.tags.slice(0, 16),
    attributes: c.u.attributes && Object.keys(c.u.attributes).length ? c.u.attributes : undefined,
  }));

  const sys =
    'You are an expert personal buyer for a client. You are given the client\'s brief in their own words, plus a numbered list of candidate products, each with its title, description, tags, structured attributes, availability and price. ' +
    'Decide which candidates the client would genuinely accept as fulfilling their brief, reasoning over the COMPLETE product data , the structured `attributes` are authoritative facts (e.g. label, pressing/edition, year, condition/grade, material, size, colour, origin), not just the title or prose. ' +
    'Use real judgement, not literal word-matching. Map the client\'s meaning onto the product\'s facts: e.g. an "Original" pressing IS a first edition/first pressing; a `label` attribute equal to the label they named means it IS on that label; "made in Japan" is shown by a Japanese origin/maker; equivalent size, condition or material wording counts. The exact words need not appear. ' +
    'Honour the client\'s specificity: for EACH hard requirement the client EXPLICITLY stated ("raw denim", "made in Japan", "on the Acid Jazz label", "first pressing", "gluten free", a size/fitment), the product\'s own data must POSITIVELY support that requirement , directly or by clear equivalence (an "Original" pressing supports "first pressing"; "cold brew" supports "coffee"; a Japanese maker or stated Japanese origin supports "made in Japan"). The exact words need not appear, but the support must be THERE. If the data is SILENT on a stated requirement, or contradicts it, EXCLUDE the product , do not assume an unstated fact is true (a jean that does not show Japanese origin fails "made in Japan"; a washed/stretch jean fails "raw denim"; a reissue fails "first pressing"; a record merely in the genre is not on that label). ' +
    'Apply that strictness ONLY to the hard specifics the client actually stated. Where the brief is BROAD (few or no stated requirements), be INCLUSIVE and judge by category and spirit: return every product a reasonable person would consider on-topic, generously. For example "a gift of coffee" is satisfied by ANY coffee , whole bean, ground, pods, or ready-to-drink / cold brew / latte / espresso / decaf coffee drinks, and coffee gift sets; "something to read" by any book. Do not demand the literal word; a "canned decaf cold brew oat latte" IS coffee. ' +
    'SUBJECT-MATTER / TOPIC briefs (a document, book, essay, article, report, guide, or any product described by what it is ABOUT) are judged by TOPIC OVERLAP, not verbatim words, and near-synonymous subjects are EQUIVALENT: web3 covers blockchain, crypto, NFT, on-chain, tokenisation, DAOs; AI covers agentic, machine learning, LLM, autonomous agents. A brief naming several topics ("a document about web3 and fashion") is satisfied by any product genuinely in that subject area even if it foregrounds ONE facet , a digital-fashion essay that discusses NFTs/blockchain DOES fit "web3 and fashion", and an essay on agentic commerce fits "web3" or "AI". Do not require every named topic to be equally prominent, and do not exclude an on-subject document because one topic word is implied rather than stated. ' +
    'Do not pad with near-misses that contradict a stated requirement; equally, do not drop a product that fits the brief\'s category and spirit just because it is not a textbook example. Return the genuine matches; if truly none fit, return none. ' +
    'RANKING: the actual product the client asked for ranks ABOVE accessories or equipment FOR that product. For "a gift of coffee", the coffee itself (beans, ground, ready-to-drink) outranks coffee makers, grinders and brewers; for "denim", jeans outrank denim-care kits. Accessories may still be included lower down, but the real thing scores highest. ' +
    'Respond as JSON: {"matches":[{"i":<index>,"score":<0-100>}]}, score = how well the product fits the brief (and the client\'s taste). Omit any product that does not genuinely fit.';

  const user = JSON.stringify({
    brief: intentText,
    client_key_points: brief.requirements,   // your own prior read of the brief; defer to the brief's intent
    nice_to_haves: brief.preferences,
    buyer_taste: preferredTerms,
    budget_usd: brief.budget_usd,
    candidates: list,
  });

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      console.warn(`[buyer-matching] DeepSeek judge ${res.status}; falling back to deterministic scoring`);
      return null;
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    addUsage(meter, json);
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as { matches?: Array<{ i?: unknown; score?: unknown }> };
    const out = new Map<string, number>();
    for (const m of parsed.matches ?? []) {
      const i = typeof m.i === 'number' ? m.i : Number(m.i);
      if (!Number.isInteger(i) || i < 0 || i >= candidates.length) continue;
      const score = typeof m.score === 'number' ? m.score : 0;
      out.set(candidates[i].key, score);
    }
    return out;
  } catch (e) {
    console.warn('[buyer-matching] DeepSeek judge threw; falling back to deterministic scoring:', e);
    return null;
  }
}

const lc = (s: string) => s.toLowerCase();
/** Significant (>= 3 char) lowercase word tokens of a string. */
function tokens(s: string): string[] {
  return lc(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3);
}

export interface BuyerPrefs {
  maxUsd: number | null;       // hard budget ceiling per item (from a 'budget' memory)
  preferredTerms: string[];    // genres / categories / brands to rank higher
}

/**
 * Distil the buyer's active training (app_buyer_memories) into the signals
 * discovery can act on deterministically: a budget ceiling (hard filter) and
 * preferred genres/brands (ranking boost). Condition + delivery preferences are
 * applied later (negotiation / checkout), not here.
 */
async function loadBuyerPrefs(buyerId: string): Promise<BuyerPrefs> {
  const { data } = await db
    .from('app_buyer_memories')
    .select('type, structured')
    .eq('buyer_id', buyerId)
    .eq('active', true);

  let maxUsd: number | null = null;
  const preferred = new Set<string>();
  for (const m of (data ?? []) as Array<{ type: string; structured: Record<string, unknown> | null }>) {
    const s = (m.structured ?? {}) as Record<string, unknown>;
    if (m.type === 'budget' && typeof s.max_usd === 'number' && s.max_usd > 0) {
      maxUsd = maxUsd === null ? s.max_usd : Math.min(maxUsd, s.max_usd);
    }
    for (const key of ['categories', 'genres', 'brands', 'brand']) {
      const v = s[key];
      if (Array.isArray(v)) {
        for (const x of v) if (typeof x === 'string' && x.trim().length >= 3) preferred.add(x.trim().toLowerCase());
      } else if (typeof v === 'string' && v.trim().length >= 3) {
        preferred.add(v.trim().toLowerCase());
      }
    }
  }
  return { maxUsd, preferredTerms: Array.from(preferred) };
}

/** Reuse the cached structured intent from structured.search_intent, else extract
 *  (and flag for persistence so the cron does not re-pay for the LLM). */
async function resolveIntent(intent: IntentLite, meter?: TokenMeter): Promise<{ brief: BriefIntent; extracted: boolean }> {
  const cached = (intent.structured as Record<string, unknown> | null)?.search_intent as Partial<BriefIntent> | undefined;
  if (cached && Array.isArray(cached.terms) && cached.terms.length > 0) {
    return {
      brief: {
        terms:        asStrings(cached.terms, 3),
        category:     typeof cached.category === 'string' ? cached.category : null,
        type_terms:   asStrings(cached.type_terms, 6),
        requirements: asStrings(cached.requirements, 8),
        preferences:  asStrings(cached.preferences, 8),
        budget_usd:   typeof cached.budget_usd === 'number' ? cached.budget_usd : null,
        teaser_attribute: typeof cached.teaser_attribute === 'string' ? cached.teaser_attribute : null,
      },
      extracted: false,
    };
  }
  return { brief: await extractIntent(intent.intent_text, meter), extracted: true };
}

/** Tighter of the brief budget and the training budget (either may be null). */
export function compoundBudget(briefBudget: number | null, trainingBudget: number | null): number | null {
  const vals = [briefBudget, trainingBudget].filter((v): v is number => typeof v === 'number' && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

/**
 * Training terms (preferred brands / categories / genres) that ALIGN with this
 * brief , they share a word with the brief's category, terms, or attributes. A
 * "japanese denim" affinity sharpens a denim brief; a "techno" affinity on the
 * same buyer does NOT get mixed in (it belongs to a different vertical / brief).
 * Used both to expand the query and to boost ranking, so training never drags a
 * brief across verticals.
 */
export function alignedTrainingTerms(brief: BriefIntent, preferredTerms: string[]): string[] {
  const anchor = new Set<string>();
  for (const s of [brief.category ?? '', ...brief.terms, ...brief.type_terms, ...brief.requirements, ...brief.preferences]) {
    for (const t of tokens(s)) anchor.add(t);
  }
  return preferredTerms.filter((p) => tokens(p).some((t) => anchor.has(t)));
}

/**
 * Deterministic fallback scorer, used ONLY when the AI judge is unavailable (no
 * DeepSeek key / API down) so matching degrades instead of returning nothing.
 * Now it reads the candidate's full description + tags (not just the title), and
 * the REQUIREMENT terms are the heavy signal so a requirement hit outranks a bare
 * product-type hit. The judge is the real precision; this just keeps the lights on.
 */
export function intentScore(u: UnifiedProduct, brief: BriefIntent, alignedTerms: string[], budget: number | null): number {
  const hay = lc(`${u.title} ${u.seller ?? ''} ${u.description ?? ''} ${u.tags.join(' ')} ${u.detail ?? ''}`);
  let score = 0;
  for (const term of brief.terms) score += relevanceScore(hay, term);
  for (const r of brief.requirements) if (tokens(r).every((t) => hay.includes(t))) score += 5; // all words of a requirement present
  for (const t of brief.type_terms) if (tokens(t).some((tok) => hay.includes(tok))) score += 2;
  for (const p of brief.preferences) if (tokens(p).some((t) => hay.includes(t))) score += 1;
  if (brief.category) for (const t of tokens(brief.category)) if (hay.includes(t)) score += 1;
  if (alignedTerms.length) score += alignedTerms.filter((t) => hay.includes(t)).length * 2;
  if (budget !== null && u.price_usdc !== null && u.price_usdc > budget) score -= 2;
  return score;
}

export const MATCH_FLOOR_FRACTION = 0.34; // drop hits scoring far below the best aligned match

function slugify(s: string): string {
  return lc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seller';
}

/**
 * The matcher CORE, shared by the buyer sourcing loop and the inbound
 * submit_intent endpoint: compound the brief with the buyer's training, recall a
 * wide net across the whole network (interleaved local + members, vertical-gated),
 * then let the AI judge keep only the genuine fits. Returns the ranked matches.
 * Pure: no persistence, no side effects , callers decide what to do with the result.
 */
export async function runMatch(
  intentText: string,
  brief: BriefIntent,
  prefs: BuyerPrefs,
  meter?: TokenMeter,
): Promise<{ ranked: { u: UnifiedProduct; score: number }[]; judged: boolean }> {
  const alignedTerms = alignedTrainingTerms(brief, prefs.preferredTerms);
  const budget = compoundBudget(brief.budget_usd, prefs.maxUsd);

  // RECALL: cast a wide net across the WHOLE network using the brief's broad
  // terms, its product-type nouns/synonyms, its hard requirements, and aligned
  // training terms. type_terms matter because `terms` can be a multi-word phrase
  // ("sourdough bread") that matches NOTHING under the catalogue's AND/phrase FTS
  // when no single product carries every word; the single-word type_terms
  // ("sourdough", "bread", "loaf") are what actually recall the candidates. Keep
  // LOCAL and MEMBER candidates in separate pools, then INTERLEAVE them into the
  // judge's budget , otherwise one source's volume (e.g. local vinyl that merely
  // mentions "coffee") starves the other (a member's actual coffee) before the
  // judge sees it.
  // Build the recall net from the brief's phrases AND the individual words within
  // them. The catalogue FTS is AND/phrase based: a multi-word term the extractor
  // emits ("web3 fashion document", "sourdough bread") matches NOTHING when no
  // single product carries every word, so recall would come back empty and the
  // judge would never see the right item. Adding the atomic words ("web3",
  // "fashion", "sourdough") guarantees coverage; the cross-vertical gate + judge
  // remain the precision filter. Capped so we don't fan out into too many fetches.
  const phrases: string[] = [];
  const words: string[] = [];
  for (const t of [...brief.terms, ...brief.type_terms, ...brief.requirements, ...alignedTerms]) {
    const phrase = t.trim().toLowerCase();
    if (phrase.length >= 2 && !phrases.includes(phrase)) phrases.push(phrase);
    for (const w of phrase.split(/\s+/)) {
      const word = w.replace(/[^a-z0-9]/g, '');
      if (word.length >= 3 && !words.includes(word)) words.push(word);
    }
  }
  // 2-word AND-pairs of the brief's content words. These NARROW past a
  // high-volume catalogue: bare "fashion" returns 50 vinyl records and buries a
  // niche essay, but "digital fashion" (AND) returns ~20 and surfaces it. Pairs
  // are tried BEFORE bare singles for that reason; singles still recall the cases
  // where one word is already discriminating ("sourdough"). Order-independent
  // under FTS AND, so only unordered pairs.
  const pairWords = words.slice(0, 5);
  const pairs: string[] = [];
  for (let i = 0; i < pairWords.length; i++)
    for (let j = i + 1; j < pairWords.length; j++)
      pairs.push(`${pairWords[i]} ${pairWords[j]}`);
  const recallTerms = Array.from(new Set([...phrases, ...pairs, ...words])).slice(0, 16);
  const localPool = new Map<string, UnifiedProduct>();
  const memberPool = new Map<string, UnifiedProduct>();
  const addTo = (m: Map<string, UnifiedProduct>, u: UnifiedProduct) => {
    const key = u.mcp_ref.product_id ?? u.page_url;
    if (key && u.page_url && !m.has(key)) m.set(key, u); // a match row needs a clickable product_url
  };
  // Cross-vertical gate: when the brief is clearly in one domain (e.g. food), do
  // NOT consider candidates from a different known domain (e.g. a record in
  // music/vinyl). Only gates when BOTH domains are known, so it never hides
  // un-categorised items.
  const briefDomain = brief.category ? brief.category.split('/')[0].trim().toLowerCase() : null;
  const sameDomain = (u: UnifiedProduct): boolean => {
    if (!briefDomain || !u.category) return true;
    return u.category.split('/')[0].trim().toLowerCase() === briefDomain;
  };
  // Fan out the recall terms concurrently; one slow member never serialises the
  // others, and the wider term set (phrases + pairs + words) stays fast.
  const batches = await Promise.all(
    recallTerms.map((term) => recallNetwork(term, RECALL_LOCAL, RECALL_MEMBER)),
  );
  for (const { local, members } of batches) {
    for (const u of local) if (sameDomain(u)) addTo(localPool, u);
    for (const u of members) if (sameDomain(u)) addTo(memberPool, u);
  }
  const localEntries = [...localPool.entries()];
  const memberEntries = [...memberPool.entries()];
  const candidateList: { key: string; u: UnifiedProduct }[] = [];
  for (let li = 0, mi = 0; candidateList.length < JUDGE_LIMIT && (li < localEntries.length || mi < memberEntries.length); ) {
    if (li < localEntries.length) { const [key, u] = localEntries[li++]; candidateList.push({ key, u }); }
    if (candidateList.length >= JUDGE_LIMIT) break;
    if (mi < memberEntries.length) { const [key, u] = memberEntries[mi++]; candidateList.push({ key, u }); }
  }

  // JUDGE: the AI keeps only products that genuinely fit, scored. Falls back to
  // deterministic scoring + a floor if the judge is unavailable.
  const verdict = await judgeCandidates(intentText, brief, prefs.preferredTerms, candidateList, meter);
  if (verdict) {
    const ranked = candidateList
      .filter((c) => verdict.has(c.key))
      .map((c) => ({ u: c.u, score: verdict.get(c.key)! }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MATCH_LIMIT);
    return { ranked, judged: true };
  }
  // No AI verdict: keyword fallback ONLY so an interactive search degrades to
  // something rather than nothing. judged=false signals callers NOT to persist
  // this (it is cross-vertical-noisy); the matcher must be LLM-judged to write.
  const scored = candidateList.map((c) => ({ u: c.u, score: intentScore(c.u, brief, alignedTerms, budget) }));
  const topScore = scored.reduce((m, c) => Math.max(m, c.score), 0);
  const floor = topScore > 0 ? topScore * MATCH_FLOOR_FRACTION : -Infinity;
  const ranked = scored.filter((c) => c.score >= floor).sort((a, b) => b.score - a.score).slice(0, MATCH_LIMIT);
  return { ranked, judged: false };
}

export interface MatchResult {
  title: string; seller: string | null; source: string; score: number;
  price_usdc: number | null; currency: string; page_url: string | null;
  mcp_url: string; category: string | null;
}

function serializeMatches(ranked: { u: UnifiedProduct; score: number }[]): MatchResult[] {
  return ranked.map(({ u, score }) => ({
    title: u.title, seller: u.seller, source: u.source, score,
    price_usdc: u.price_usdc, currency: 'USDC', page_url: u.page_url,
    mcp_url: u.mcp_ref.seller_mcp_url, category: u.category,
  }));
}

/** Dry-run the matcher for an ad-hoc brief: extract intent, run the core, return
 *  serialisable results. No persistence, no buyer training. Backs the anonymous
 *  inbound submit_intent (network MCP + /api/via/match) and the eval battery. */
export async function dryRunMatch(intentText: string): Promise<{ intent: BriefIntent; results: MatchResult[] }> {
  const brief = await extractIntent(intentText);
  const { ranked } = await runMatch(intentText, brief, { maxUsd: null, preferredTerms: [] });
  return { intent: brief, results: serializeMatches(ranked) };
}

/**
 * Agentic network search backing the discovery MCP's find_seller: extract intent,
 * run the full matcher (network recall + cross-vertical gate + AI judge), and
 * return ranked UnifiedProducts. This is why "sourdough bread" returns Eli's
 * sourdough and NOT "Bread" the band: lexical FTS cannot disambiguate the food
 * intent from the popular vinyl term; the judge can. Returns the rich product
 * shape (image_url, mcp_ref, category) the discovery tool already speaks.
 */
export async function agenticNetworkSearch(query: string, max: number): Promise<{ intent: BriefIntent; products: UnifiedProduct[] }> {
  const brief = await extractIntent(query);
  const { ranked } = await runMatch(query, brief, { maxUsd: null, preferredTerms: [] });
  return { intent: brief, products: ranked.slice(0, max).map((r) => r.u) };
}

/** Read a cached structured intent into a BriefIntent (no re-extraction). */
export function briefIntentFromStructured(structured: Record<string, unknown> | null): BriefIntent {
  const si = ((structured ?? {})['search_intent'] ?? {}) as Record<string, unknown>;
  return {
    terms:        asStrings(si.terms, 3),
    category:     typeof si.category === 'string' ? si.category : null,
    type_terms:   asStrings(si.type_terms, 6),
    requirements: asStrings(si.requirements, 8),
    preferences:  asStrings(si.preferences, 8),
    budget_usd:   typeof si.budget_usd === 'number' ? si.budget_usd : null,
    teaser_attribute: typeof si.teaser_attribute === 'string' ? si.teaser_attribute : null,
  };
}

export interface PitchProduct {
  title: string;
  description?: string | null;
  price_usdc?: number | null;
  tags?: string[];
  attributes?: Record<string, unknown>;
}

/**
 * Judge ONE seller-supplied product against ONE buyer brief and return a verdict
 * with a reason , the precision behind pitch_against_brief. Same discipline as the
 * main judge: a stated requirement must be POSITIVELY supported by the product's
 * data or it does not fit. Falls back to the deterministic scorer with no key.
 */
export interface PitchVerdict {
  fits:   boolean;
  score:  number;
  reason: string;
  /** The buyer's hard requirements this product DOES satisfy (directly or by equivalence). */
  met:    string[];
  /** The hard requirements it does NOT satisfy , the differences to surface to the buyer. */
  unmet:  string[];
}

const strList = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 80)).slice(0, cap) : [];

export async function judgeProductAgainstBrief(
  intentText: string,
  brief: BriefIntent,
  product: PitchProduct,
): Promise<PitchVerdict> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const u = { title: product.title, seller: null, description: product.description ?? null,
      tags: product.tags ?? [], detail: null, price_usdc: product.price_usdc ?? null } as unknown as UnifiedProduct;
    const score = intentScore(u, brief, [], brief.budget_usd);
    return { fits: score >= 5, score: Math.min(100, score * 12), reason: 'Heuristic match against the brief (LLM judge unavailable).', met: [], unmet: [] };
  }
  const sys =
    'You are the buyer\'s personal agent. A seller is pitching ONE product against the buyer\'s brief. Decide how well it fits. ' +
    'Read the product\'s `attributes` (colours, sizes, product_type, shopify_tags, sample SKUs) as AUTHORITATIVE structured data, alongside its title and description. ' +
    'Judge by MEANING, not literal words , map the buyer\'s intent onto the product\'s facts. Equivalences count as SATISFIED: "loose" ≈ baggy ≈ relaxed ≈ wide ≈ oversized; a named heritage denim brand (Levi\'s, Lee, Wrangler, Edwin and similar long-established makers) satisfies "heritage brand"; a Japanese maker/origin satisfies "japanese"; an "Original" pressing IS a first pressing; equivalent size, colour, condition or material wording all count. A wanted colour/size is met if it appears among the product\'s available variants (the buyer picks that variant); "men\'s" is met by that gender OR unisex. ' +
    'Judge the product by what it FUNDAMENTALLY IS , its real product category , not by suggestive words in its title (a "Hero\'s Journey Tee" is a t-shirt, not a book). A product from a different category never fits: apparel does not satisfy a request for a book. But treat equivalent forms WITHIN one category as the same , a request for a book or reading material is satisfied by books, e-books, reports, papers, guides, documents, essays, or other printed or written matter on the subject (physical or digital). ' +
    'For EACH hard requirement the buyer stated, decide if the product POSITIVELY supports it (directly or by the equivalences above). Put the requirements it satisfies in `met` and those it does not (contradicted, or the data is genuinely silent) in `unmet`, using the buyer\'s own wording for each. Together `met` + `unmet` must cover every hard requirement. ' +
    'fits = true ONLY when `unmet` is empty (every hard requirement satisfied). If some but not all are satisfied it is a PARTIAL match: fits = false, but `met` still lists what it does satisfy. Reserve an empty `met` (true no-fit) for the wrong category or a product that contradicts the core of the brief. Where the brief is broad with no hard requirements, judge by category and spirit. ' +
    'Score 0-100 by overall fit. Respond as JSON: {"fits": <bool>, "score": <0-100>, "met": [<requirement strings>], "unmet": [<requirement strings>], "reason": "<one sentence to the buyer>"}.';
  const user = JSON.stringify({
    brief: intentText,
    hard_requirements: brief.requirements,
    preferences: brief.preferences,
    budget_usd: brief.budget_usd,
    product,
  });
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-v4-flash', temperature: 0, max_tokens: 320,
        response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`judge ${res.status}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const p = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as { fits?: unknown; score?: unknown; reason?: unknown; met?: unknown; unmet?: unknown };
    const score = typeof p.score === 'number' ? Math.max(0, Math.min(100, p.score)) : 0;
    const met = strList(p.met, 12);
    const unmet = strList(p.unmet, 12);
    return { fits: p.fits === true && unmet.length === 0, score, reason: typeof p.reason === 'string' ? p.reason.slice(0, 300) : '', met, unmet };
  } catch (e) {
    console.warn('[buyer-matching] pitch judge failed:', e);
    return { fits: false, score: 0, reason: 'Could not evaluate the pitch.', met: [], unmet: [] };
  }
}

/** Dry-run the matcher APPLYING a specific buyer's training (taste + budget).
 *  Backs the per-buyer submit_intent so a delegated agent's enquiry is shaped by
 *  how that buyer buys. No persistence. */
export async function dryRunMatchForBuyer(buyerId: string, intentText: string): Promise<{ intent: BriefIntent; results: MatchResult[] }> {
  const meter: TokenMeter = { tokens: 0 };
  const brief = await extractIntent(intentText, meter);
  const prefs = await loadBuyerPrefs(buyerId);
  const { ranked } = await runMatch(intentText, brief, prefs, meter);
  await meterAgainstBuyer(buyerId, meter);
  return { intent: brief, results: serializeMatches(ranked) };
}

/**
 * Match one intent against the catalogue and persist any new hits. Idempotent:
 * already-stored products are skipped. Marks the intent broadcast (and matched,
 * if it was still open) and notifies the owner when new matches land.
 */
export async function matchIntent(intent: IntentLite): Promise<{ found: number; inserted: number }> {
  const q = (intent.intent_text || '').trim();
  if (q.length < 2) return { found: 0, inserted: 0 };

  const meter: TokenMeter = { tokens: 0 };
  const { brief, extracted } = await resolveIntent(intent, meter);
  const nowIso = new Date().toISOString();

  // Cache the structured intent on the intent so the cron reuses it (no repeat
  // LLM cost). search_terms kept alongside for any reader of the legacy field.
  if (extracted) {
    const merged = { ...(intent.structured ?? {}), search_intent: brief, search_terms: brief.terms };
    await db.from('app_buyer_intents').update({ structured: merged }).eq('id', intent.id);
  }

  // Compound the brief intent with the buyer's TRAINING. Training is applied as
  // SOFT signals only , the agent learns taste and surfaces options, it never
  // hides them. Aligned preferred terms (same vertical as the brief) expand the
  // query and boost ranking; the budget is the tighter of brief + training and
  // only nudges over-budget items down, never filters them out (hard only at
  // negotiation / purchase).
  const prefs = await loadBuyerPrefs(intent.buyer_id);
  const { ranked, judged } = await runMatch(q, brief, prefs, meter);

  // Meter the platform DeepSeek spend (extract + judge) against this buyer's
  // credits. All LLM calls are done by this point, so charge once here.
  await meterAgainstBuyer(intent.buyer_id, meter);

  // Matching MUST be LLM-judged to persist. With no AI verdict (DeepSeek down),
  // runMatch falls back to keyword scoring, which is cross-vertical-noisy (e.g.
  // "Digital" albums for a "digital document" brief). Never write that. Leave the
  // existing matches untouched; a later judged run reconciles them.
  if (!judged) {
    console.warn(`[buyer-matching] judge unavailable for intent ${intent.id}; matches left unchanged`);
    return { found: 0, inserted: 0 };
  }

  // RECONCILE to the judged set: the judge is authoritative, so PRUNE any
  // persisted match that is no longer a genuine match (stale rows from earlier or
  // looser runs) before inserting new hits. Without this, matches only ever
  // accumulate and bad rows linger on the dashboard forever.
  const rankedKeys = new Set(
    ranked.map(({ u }) => u.mcp_ref.product_id ?? u.page_url).filter((k): k is string => Boolean(k)),
  );
  const { data: priorRows } = await db
    .from('app_buyer_intent_matches')
    .select('id, product_id')
    .eq('intent_id', intent.id);
  const prior = (priorRows ?? []) as { id: string; product_id: string }[];
  const staleIds = prior.filter((r) => !rankedKeys.has(r.product_id)).map((r) => r.id);
  if (staleIds.length > 0) {
    const { error: delErr } = await db.from('app_buyer_intent_matches').delete().in('id', staleIds);
    if (delErr) console.error('[buyer-matching] prune stale matches failed:', delErr.message);
  }

  if (ranked.length === 0) {
    await db.from('app_buyer_intents').update({ broadcast_at: nowIso }).eq('id', intent.id);
    return { found: 0, inserted: 0 };
  }

  // Dedup inserts against the matches that survived the prune.
  const seen = new Set(prior.filter((r) => rankedKeys.has(r.product_id)).map((r) => r.product_id));

  const rows = ranked
    .map(({ u, score }) => ({ key: u.mcp_ref.product_id ?? u.page_url!, u, score }))
    .filter(({ key }) => !seen.has(key))
    .map(({ key, u, score }) => ({
      intent_id:      intent.id,
      buyer_id:       intent.buyer_id,
      product_id:     key,
      seller_slug:    u.seller_slug ?? slugify(u.seller ?? u.source),
      seller_name:    u.seller ?? (u.source === 'via' ? 'VIA' : u.source.toUpperCase()),
      title:          u.title,
      price_usdc:     u.price_usdc,
      currency:       'USDC',
      image_url:      u.image_url,
      product_url:    u.page_url!,
      seller_mcp_url: u.mcp_ref.seller_mcp_url,
      source:         u.source,
      score,
    }));

  let inserted = 0;
  if (rows.length > 0) {
    const { error, count } = await db
      .from('app_buyer_intent_matches')
      .insert(rows, { count: 'exact' });
    if (error) console.error('[buyer-matching] match insert failed:', error.message);
    else inserted = count ?? rows.length;
  }

  const patch: Record<string, unknown> = { broadcast_at: nowIso };
  if (intent.status === 'open' || intent.status === 'broadcast') patch.status = 'matched';
  await db.from('app_buyer_intents').update(patch).eq('id', intent.id);

  if (inserted > 0) {
    const { data: buyer } = await db
      .from('app_buyers')
      .select('handle, owner_user_id')
      .eq('id', intent.buyer_id)
      .maybeSingle();
    if (buyer) {
      const top = ranked[0].u.title;
      await insertNotification({
        ownerUserId: buyer.owner_user_id as string,
        kind:        'system',
        title:       `${inserted} new ${inserted === 1 ? 'match' : 'matches'} for your brief`,
        body:        `"${q.slice(0, 80)}" , ${top}${ranked.length > 1 ? ` and ${ranked.length - 1} more` : ''}`,
        link:        `/buyer/${buyer.handle}/admin`,
        metadata:    { intent_id: intent.id, inserted, buyer_id: intent.buyer_id },
      });
    }
  }

  return { found: ranked.length, inserted };
}

/**
 * Re-match every active intent across all buyers. Used by the cron. Active =
 * open / broadcast / matched (cancelled and resolved intents are left alone).
 * Oldest-broadcast first so a backlog drains fairly.
 */
export async function matchOpenIntents(max = 200): Promise<{ intents: number; inserted: number }> {
  const { data } = await db
    .from('app_buyer_intents')
    .select('id, buyer_id, intent_text, status, structured')
    .in('status', ['open', 'broadcast', 'matched'])
    .order('broadcast_at', { ascending: true, nullsFirst: true })
    .limit(max);

  const intents = (data ?? []) as IntentLite[];
  let inserted = 0;
  let skipped = 0;
  for (const it of intents) {
    // Don't re-source briefs for buyers who can't pay , matching always spends
    // platform DeepSeek, and the cron must not drive a spent buyer negative.
    if (!(await hasCredits(it.buyer_id))) { skipped++; continue; }
    try {
      const r = await matchIntent(it);
      inserted += r.inserted;
    } catch (e) {
      console.error('[buyer-matching] matchOpenIntents item failed:', it.id, e);
    }
  }
  if (skipped > 0) console.log(`[buyer-matching] matchOpenIntents skipped ${skipped} brief(s) for out-of-credit buyers`);
  return { intents: intents.length, inserted };
}
