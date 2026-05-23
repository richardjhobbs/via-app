/**
 * Relevance-match watcher for the personal Concierge.
 *
 * The notification has to read like the agent is acting in the owner's
 * interest. NOT "the platform recommends this". The way we get there:
 * every alert is anchored to something the owner has actually said or
 * shown, and the alert quotes back that moment so they can see the
 * agent remembered.
 *
 * Two surfaces are scanned each run:
 *   1. Newly approved listings from the last 24h.
 *   2. Brands that became active on RRG in the last 24h.
 *
 * For each, paths that can fire an in-app notification:
 *   A. Loved-brand path: the brand is in the owner's loved set.
 *   B. Explicit watch path: a previous chat_followup notification
 *      persisted a watch_term (the LLM called via_notify_owner) and
 *      this item hits one of those terms.
 *   C. Past-question path: a previous user message asked about
 *      something with ≥2 distinct meaningful tokens overlapping the
 *      item.
 *   D. Profile path (BRANDS ONLY): text hits at least 2 distinct
 *      signal axes drawn from style_tags, interest_categories,
 *      persona_bio + free_instructions, and learned agent_memory.
 *
 * Listings no longer fire on profile-only matches. Per user spec,
 * product emails require a concrete past-conversation, watch_term,
 * or loved-brand anchor.
 *
 * Avoided brands are blocked from every path.
 *
 * EMAIL POLICY (per user spec 2026-05-23):
 *   - At most ONE email per owner email address per rolling 24h window.
 *   - All matches across all agents an owner controls are merged,
 *     dedup'd by brand_id / token_id, and delivered as a single
 *     digest email.
 *   - Dashboard notifications still fire per-agent per-match. The
 *     bundling is purely email-layer.
 */

import { db } from '@/lib/rrg/db';
import type { AgentMemory } from './memory';
import {
  sendOwnerDailyDigest,
  type DigestBrand,
  type DigestListing,
  type DigestPayload,
} from './email';
import { deductCredits, hasCapAvailable } from './credits';

interface AgentRow {
  id: string;
  name: string;
  email: string | null;
  tier: string;
  style_tags: string[] | null;
  interest_categories: Array<{ category: string; tags: string[] }> | null;
  persona_bio: string | null;
  free_instructions: string | null;
  sex: 'male' | 'female' | 'other' | null;
  status: string;
}

interface DropRow {
  token_id: number;
  title: string;
  enhanced_description: string | null;
  description: string | null;
  audience: string | null;
  brand_id: string | null;
  brand_slug: string | null;
  brand_name: string | null;
  approved_at: string;
  price_usdc: number | null;
}

interface BrandRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  brand_data: Record<string, unknown> | null;
}

interface ScanOpts {
  /** Look-back window in hours for newly approved listings and new brands. Default 24. */
  hoursBack?: number;
  /** Total notifications written per agent per scan (sum of listing + brand). Default 5. */
  perAgentLimit?: number;
}

export interface ScanResult {
  agents_scanned: number;
  listings_considered: number;
  brands_considered: number;
  notifications_created: number;
  emails_sent: number;
  dedup_skipped: number;
  owners_emailed: number;
  owners_capped_today: number;
  owners_with_no_email: number;
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

const STOPWORDS = new Set([
  'the','and','for','with','from','your','this','that','these','those',
  'have','will','would','could','should','about','just','also','only',
  'when','where','what','which','very','more','most','some','each','every',
  'over','under','into','onto','then','than','they','them','their','there',
  'here','been','being','were','was','are','any','all','one','two','three',
]);

function tokenize(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)) {
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

interface ProfileSignals {
  loved: Set<string>;
  avoided: Set<string>;
  styleTags: Set<string>;
  interestTags: Set<string>;
  memoryTokens: Set<string>;
  personaTokens: Set<string>;
}

function buildProfile(agent: AgentRow, memories: AgentMemory[]): ProfileSignals {
  const loved = new Set<string>();
  const avoided = new Set<string>();
  for (const m of memories) {
    if (m.type !== 'brand' || !m.active) continue;
    const c = m.content.toLowerCase();
    const isAvoid = c.startsWith('avoids ');
    const isLike = /^(likes|loves|liked)\s+/.test(c);
    const sub = c
      .replace(/^(likes|loves|liked|avoids)\s+/, '')
      .replace(/\s*\(set at signup\)\s*$/, '')
      .trim();
    if (!sub) continue;
    const first = sub.split(/\s+/)[0];
    if (isAvoid) {
      avoided.add(sub);
      if (first) avoided.add(first);
    } else if (isLike) {
      loved.add(sub);
      if (first) loved.add(first);
    }
  }

  const styleTags = new Set<string>();
  for (const t of agent.style_tags ?? []) for (const w of tokenize(t)) styleTags.add(w);

  const interestTags = new Set<string>();
  for (const cat of agent.interest_categories ?? []) {
    if (!cat || !Array.isArray(cat.tags)) continue;
    for (const t of cat.tags) for (const w of tokenize(t)) interestTags.add(w);
    if (cat.category) for (const w of tokenize(cat.category)) interestTags.add(w);
  }

  const memoryTokens = new Set<string>();
  for (const m of memories) {
    if (!m.active) continue;
    if (m.type === 'brand') continue;
    for (const w of tokenize(m.content)) memoryTokens.add(w);
  }

  const personaTokens = new Set<string>();
  for (const w of tokenize(agent.persona_bio)) personaTokens.add(w);
  for (const w of tokenize(agent.free_instructions)) personaTokens.add(w);

  return { loved, avoided, styleTags, interestTags, memoryTokens, personaTokens };
}

function scoreText(text: string, profile: ProfileSignals): { sources: string[]; hits: Map<string, string[]> } {
  const docTokens = tokenize(text);
  const hits = new Map<string, string[]>();
  const axes: Array<[string, Set<string>]> = [
    ['style', profile.styleTags],
    ['interest', profile.interestTags],
    ['memory', profile.memoryTokens],
    ['persona', profile.personaTokens],
  ];
  for (const [label, set] of axes) {
    if (set.size === 0) continue;
    const matched: string[] = [];
    for (const t of docTokens) if (set.has(t)) matched.push(t);
    if (matched.length > 0) hits.set(label, matched.slice(0, 5));
  }
  return { sources: Array.from(hits.keys()), hits };
}

function audienceOk(ownerSex: AgentRow['sex'], dropAudience: string | null): boolean {
  if (!ownerSex || !dropAudience) return true;
  const a = dropAudience.toLowerCase();
  if (a === 'unisex' || a === 'unknown') return true;
  if (ownerSex === 'male' && a === 'women') return false;
  if (ownerSex === 'female' && a === 'men') return false;
  return true;
}

function brandInSet(slug: string | null, name: string | null, set: Set<string>): boolean {
  if (set.size === 0) return false;
  const s = (slug ?? '').toLowerCase();
  const n = (name ?? '').toLowerCase();
  if (s && set.has(s)) return true;
  if (n) {
    if (set.has(n)) return true;
    const first = n.split(/\s+/)[0];
    if (first && set.has(first)) return true;
  }
  return false;
}

function summariseSignals(hits: Map<string, string[]>): string {
  const parts: string[] = [];
  for (const [source, tokens] of hits) {
    if (tokens.length === 0) continue;
    parts.push(`${source} (${tokens.slice(0, 3).join(', ')})`);
  }
  return parts.join(' and ');
}

interface ChatTurn {
  created_at: string;
  content: string;
  tokens: Set<string>;
}

interface WatchTerm {
  term: string;
  created_at: string;
}

interface ChatAnchor {
  /** When the owner said the thing being quoted. */
  created_at: string;
  /** What they said, trimmed to fit a notification body. */
  snippet: string;
  /** Tokens from the past message that the new listing also contains. */
  matched: string[];
  /** True if this came from a via_notify_owner watch_term (LLM-explicit). */
  fromWatchTerm: boolean;
}

interface ConversationContext {
  /** Recent user-side chat turns, newest first. */
  turns: ChatTurn[];
  /** Explicit watch terms persisted by via_notify_owner calls. */
  watchTerms: WatchTerm[];
}

const CONVO_LOOKBACK_DAYS = 30;
const CONVO_MAX_TURNS = 60;
// Token overlap minimum. The LLM gate downstream is the relevance
// authority, so this just needs to be a cheap pre-filter that catches
// any plausible candidate; 1 lets short, specific user requests
// ("cookies?", "any skateboard brands?") anchor matches. Cost is
// bounded by the per-listing LLM call which is billed to the agent.
//
// Assistant replies are intentionally excluded from the corpus: when
// the owner asks "what's on the platform" and the concierge lists
// brands, the owner has NOT expressed a preference for those brands.
// Only direct owner messages count as conversation anchors.
const CONVO_MIN_OVERLAP = 1;

async function loadConversationContext(agentId: string): Promise<ConversationContext> {
  const since = new Date(Date.now() - CONVO_LOOKBACK_DAYS * 86400 * 1000).toISOString();

  const { data: msgs } = await db
    .from('agent_chat_messages')
    .select('created_at, content')
    .eq('agent_id', agentId)
    .eq('role', 'user')
    .eq('is_eval_preview', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(CONVO_MAX_TURNS);

  const turns: ChatTurn[] = [];
  for (const m of msgs ?? []) {
    const content = (m.content as string | null)?.trim() ?? '';
    if (content.length < 4) continue;
    const tokens = tokenize(content);
    if (tokens.size === 0) continue;
    turns.push({ created_at: m.created_at as string, content, tokens });
  }

  const { data: notifs } = await db
    .from('agent_notifications')
    .select('created_at, payload')
    .eq('agent_id', agentId)
    .eq('kind', 'chat_followup')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(40);

  const watchTerms: WatchTerm[] = [];
  for (const n of notifs ?? []) {
    const p = n.payload as { watch_terms?: string[] } | null;
    if (!p || !Array.isArray(p.watch_terms)) continue;
    for (const raw of p.watch_terms) {
      const term = String(raw ?? '').trim().toLowerCase();
      if (term.length >= 2) watchTerms.push({ term, created_at: n.created_at as string });
    }
  }

  return { turns, watchTerms };
}

function snippetFor(text: string, maxLen = 110): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * LLM relevance gate for listing emails anchored to a past chat message.
 * Token overlap is too permissive (e.g. "Any white knitted shirts for men"
 * matches a black hoodie because "white" appears in "white ink print").
 * Before we add a listing to the digest, we ask DeepSeek a tight yes/no:
 * does this product DIRECTLY answer the user's stated request?
 *
 * Returns true if relevant (proceed) or if the LLM is unavailable / errors.
 * Fail-open is intentional: a missing key or a flaky call should not silence
 * the watcher; the token gate is still the first line of defence.
 */
async function llmListingMatchesRequest(
  userMessage: string,
  listingTitle: string,
  brandName: string | null,
): Promise<{ matches: boolean; reason: string; tokensUsed: number }> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { matches: true, reason: 'llm-skipped (no key)', tokensUsed: 0 };
  }
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });

    const product = brandName ? `${brandName} - ${listingTitle}` : listingTitle;
    const system =
      'You decide whether a single product directly answers a user\'s past request. ' +
      'Be strict. The product must satisfy ALL specifics the user stated: colour, ' +
      'gender, category (shirt vs hoodie vs trainers), material, and any other ' +
      'qualifier. A black hoodie does NOT answer "white shirts". Off-white trainers ' +
      'do NOT answer "white shirts". Reply with exactly YES or NO on the first line, ' +
      'then one short sentence of reason.';
    const user = `User asked: "${userMessage}"\nProduct: ${product}\n\nDoes the product directly answer the request?`;

    const response = await client.chat.completions.create({
      model: 'deepseek-chat',
      max_tokens: 60,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = (response.choices[0]?.message?.content ?? '').trim();
    const firstLine = text.split(/\r?\n/)[0]?.trim().toUpperCase() ?? '';
    const matches = firstLine.startsWith('YES');
    const tokensUsed =
      (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
    return { matches, reason: text.slice(0, 200), tokensUsed };
  } catch (err) {
    console.error('[watcher llm gate]', err);
    return { matches: true, reason: 'llm-error (fail open)', tokensUsed: 0 };
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function findChatAnchor(text: string, ctx: ConversationContext): ChatAnchor | null {
  const docTokens = tokenize(text);
  const haystackLower = text.toLowerCase();

  // 1. Explicit watch_term wins. The LLM said "watch for X" on a given day.
  //    If the new item literally contains that term, this is the strongest
  //    possible anchor: the agent kept its word.
  let bestWatch: WatchTerm | null = null;
  for (const w of ctx.watchTerms) {
    if (!w.term) continue;
    const phrase = w.term.toLowerCase();
    if (haystackLower.includes(phrase)) {
      if (!bestWatch || new Date(w.created_at) < new Date(bestWatch.created_at)) {
        bestWatch = w;
      }
    }
  }
  if (bestWatch) {
    return {
      created_at: bestWatch.created_at,
      snippet: bestWatch.term,
      matched: [bestWatch.term],
      fromWatchTerm: true,
    };
  }

  // 2. Past-message path: pick the OWNER message with the highest meaningful
  //    overlap. Tie-break to the most recent so freshness wins.
  let best: { turn: ChatTurn; overlap: string[] } | null = null;
  for (const turn of ctx.turns) {
    const overlap: string[] = [];
    for (const t of docTokens) if (turn.tokens.has(t)) overlap.push(t);
    if (overlap.length < CONVO_MIN_OVERLAP) continue;
    if (
      !best ||
      overlap.length > best.overlap.length ||
      (overlap.length === best.overlap.length &&
        new Date(turn.created_at) > new Date(best.turn.created_at))
    ) {
      best = { turn, overlap };
    }
  }
  if (!best) return null;

  return {
    created_at: best.turn.created_at,
    snippet: snippetFor(best.turn.content),
    matched: best.overlap.slice(0, 5),
    fromWatchTerm: false,
  };
}

function composeReason(opts: {
  itemKind: 'listing' | 'brand';
  itemLabel: string;
  brandName: string | null;
  anchor: ChatAnchor | null;
  lovedBrand: boolean;
  profileHits: Map<string, string[]>;
}): string {
  const { itemKind, itemLabel, brandName, anchor, lovedBrand, profileHits } = opts;

  if (anchor && anchor.fromWatchTerm) {
    return `You asked me on ${formatDate(anchor.created_at)} to keep an eye out for "${anchor.snippet}". ${itemKind === 'brand' ? `${itemLabel} is now on RRG and fits.` : `${itemLabel}${brandName ? ` from ${brandName}` : ''} is now listed and fits.`}`;
  }
  if (anchor) {
    return `On ${formatDate(anchor.created_at)} you said "${anchor.snippet}". ${itemKind === 'brand' ? `${itemLabel} is now on RRG and lines up with that.` : `${itemLabel}${brandName ? ` from ${brandName}` : ''} is now listed and lines up with that.`}`;
  }
  if (lovedBrand && brandName) {
    return itemKind === 'brand'
      ? `${itemLabel} is on your brand list and just joined RRG.`
      : `${brandName} is on your brand list. New listing: ${itemLabel}.`;
  }
  return itemKind === 'brand'
    ? `${itemLabel} joined RRG and lines up with your ${summariseSignals(profileHits)}.`
    : `${itemLabel}${brandName ? ` from ${brandName}` : ''} lines up with your ${summariseSignals(profileHits)}.`;
}

/**
 * Per-agent in-bucket caps. These exist to keep the digest email a
 * reasonable length when the catalogue dumps a lot of new product in
 * one day; they are NOT the spam guardrail (that is the per-owner
 * 24h email cap).
 */
const BUCKET_MAX_BRANDS_PER_AGENT = 10;
const BUCKET_MAX_LISTINGS_PER_AGENT = 20;
const OWNER_EMAIL_COOLDOWN_HOURS = 24;

interface BucketAgentEntry {
  agentId: string;
  agentName: string;
  brands: Array<{ id: string; name: string; slug: string }>;
  listings: Array<{
    tokenId: number;
    title: string;
    brandName: string | null;
    priceUsdc: number | null;
    reason: string;
  }>;
}

interface OwnerBucket {
  email: string;
  agents: Map<string, BucketAgentEntry>;
}

export async function runDropMatchScan(opts: ScanOpts = {}): Promise<ScanResult> {
  const hoursBack = opts.hoursBack ?? 24;
  // perAgentLimit retained for backward compat on the in-app notification
  // write path; bucket caps are separate (see BUCKET_MAX_* above).
  const perAgentLimit = opts.perAgentLimit ?? 50;
  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  const result: ScanResult = {
    agents_scanned: 0,
    listings_considered: 0,
    brands_considered: 0,
    notifications_created: 0,
    emails_sent: 0,
    dedup_skipped: 0,
    owners_emailed: 0,
    owners_capped_today: 0,
    owners_with_no_email: 0,
  };

  const ownerBuckets = new Map<string /* lower(email) */, OwnerBucket>();
  function bucketFor(agent: AgentRow): BucketAgentEntry | null {
    if (!agent.email) return null;
    const key = agent.email.trim().toLowerCase();
    if (!key) return null;
    let bucket = ownerBuckets.get(key);
    if (!bucket) {
      bucket = { email: agent.email.trim(), agents: new Map() };
      ownerBuckets.set(key, bucket);
    }
    let entry = bucket.agents.get(agent.id);
    if (!entry) {
      entry = {
        agentId: agent.id,
        agentName: agent.name,
        brands: [],
        listings: [],
      };
      bucket.agents.set(agent.id, entry);
    }
    return entry;
  }

  const { data: agents, error: agentsErr } = await db
    .from('agent_agents')
    .select('id, name, email, tier, style_tags, interest_categories, persona_bio, free_instructions, sex, status')
    .eq('tier', 'pro')
    .eq('status', 'active');

  if (agentsErr || !agents) return result;

  // ── Pre-load: newly approved listings ─────────────────────────────
  const { data: rawDrops, error: dropsErr } = await db
    .from('rrg_submissions')
    .select('token_id, title, enhanced_description, description, audience, brand_id, approved_at, price_usdc')
    .eq('status', 'approved')
    .eq('hidden', false)
    .gte('approved_at', since)
    .order('approved_at', { ascending: false })
    .limit(500);

  let drops: DropRow[] = [];
  if (!dropsErr && rawDrops && rawDrops.length > 0) {
    const brandIds = Array.from(new Set(rawDrops.map(d => d.brand_id).filter((b): b is string => !!b)));
    const { data: brandRows } = brandIds.length > 0
      ? await db.from('rrg_brands').select('id, slug, name').in('id', brandIds)
      : { data: [] };
    const brandMap = new Map<string, { slug: string; name: string }>(
      (brandRows ?? []).map(b => [b.id as string, { slug: b.slug as string, name: b.name as string }]),
    );
    drops = rawDrops.map(d => ({
      token_id: d.token_id as number,
      title: d.title as string,
      enhanced_description: (d.enhanced_description as string | null) ?? null,
      description: (d.description as string | null) ?? null,
      audience: (d.audience as string | null) ?? null,
      brand_id: (d.brand_id as string | null) ?? null,
      brand_slug: d.brand_id ? brandMap.get(d.brand_id as string)?.slug ?? null : null,
      brand_name: d.brand_id ? brandMap.get(d.brand_id as string)?.name ?? null : null,
      approved_at: d.approved_at as string,
      price_usdc: (d.price_usdc as number | null) ?? null,
    }));
  }
  result.listings_considered = drops.length;

  // ── Pre-load: newly activated brands ──────────────────────────────
  const { data: rawBrands } = await db
    .from('rrg_brands')
    .select('id, slug, name, created_at, brand_data')
    .eq('status', 'active')
    .gte('created_at', since);
  const newBrands: BrandRow[] = (rawBrands ?? []).map(b => ({
    id: b.id as string,
    slug: b.slug as string,
    name: b.name as string,
    created_at: b.created_at as string,
    brand_data: (b.brand_data as Record<string, unknown> | null) ?? null,
  }));
  result.brands_considered = newBrands.length;

  // ── Per-agent scoring + notify + email ────────────────────────────
  for (const agent of agents as AgentRow[]) {
    result.agents_scanned++;

    const { data: mems } = await db
      .from('agent_memory')
      .select('id, type, content, active, source_session_id, agent_id, created_at, superseded_by')
      .eq('agent_id', agent.id)
      .eq('active', true);
    const memories = (mems ?? []) as AgentMemory[];
    const profile = buildProfile(agent, memories);

    const profileEmpty =
      profile.loved.size === 0 &&
      profile.styleTags.size === 0 &&
      profile.interestTags.size === 0 &&
      profile.memoryTokens.size === 0 &&
      profile.personaTokens.size === 0;
    if (profileEmpty) continue;

    // Dedupe set across both listing and brand alerts written in the last 30 days
    const dedupeSince = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const { data: existing } = await db
      .from('agent_notifications')
      .select('payload, kind')
      .eq('agent_id', agent.id)
      .in('kind', ['match_found', 'brand_match_found'])
      .gte('created_at', dedupeSince);
    const notifiedTokens = new Set<number>();
    const notifiedBrandIds = new Set<string>();
    for (const row of existing ?? []) {
      const p = row.payload as { drop_token_ids?: number[]; brand_id?: string } | null;
      if (Array.isArray(p?.drop_token_ids)) for (const id of p.drop_token_ids) notifiedTokens.add(id);
      if (p?.brand_id) notifiedBrandIds.add(p.brand_id);
    }

    // Conversation context. Pulled once per agent and reused across all
    // listings and brands. This is what makes the alerts feel personal:
    // every match prefers anchoring to something the owner has actually
    // said to the concierge.
    const convo = await loadConversationContext(agent.id);

    let writtenForThisAgent = 0;
    const brandsAlertedThisRun = new Set<string>();

    // ── Brand-level alerts first (rarer, higher signal) ─────────────
    for (const b of newBrands) {
      if (writtenForThisAgent >= perAgentLimit) break;
      if (notifiedBrandIds.has(b.id)) { result.dedup_skipped++; continue; }
      if (brandInSet(b.slug, b.name, profile.avoided)) continue;

      const isLoved = brandInSet(b.slug, b.name, profile.loved);

      const bd = b.brand_data ?? {};
      const brandTextParts: string[] = [b.name];
      for (const key of ['tagline', 'description', 'bio', 'story', 'about', 'mission']) {
        const v = bd[key];
        if (typeof v === 'string') brandTextParts.push(v);
      }
      const brandText = brandTextParts.join(' ');

      const anchor = findChatAnchor(brandText, convo);
      const scored = scoreText(brandText, profile);
      const profileOk = scored.sources.length >= 2;

      // Fire when ANY of: loved brand, anchored to past chat, or profile
      // hits at least 2 distinct axes.
      if (!isLoved && !anchor && !profileOk) continue;

      const reason = composeReason({
        itemKind: 'brand',
        itemLabel: b.name,
        brandName: b.name,
        anchor,
        lovedBrand: isLoved,
        profileHits: scored.hits,
      });
      const brandUrl = `${SITE_URL}/brand/${b.slug}`;
      const matchSource: 'watch_term' | 'past_chat' | 'loved_brand' | 'multi_signal' =
        anchor?.fromWatchTerm ? 'watch_term'
          : anchor ? 'past_chat'
            : isLoved ? 'loved_brand'
              : 'multi_signal';

      const { error: insertErr } = await db.from('agent_notifications').insert({
        agent_id: agent.id,
        kind: 'brand_match_found',
        title: `${b.name} on RRG`,
        body: reason,
        payload: {
          source: 'watcher',
          match_source: matchSource,
          brand_id: b.id,
          brand_slug: b.slug,
          hits: Object.fromEntries(scored.hits),
          chat_anchor: anchor
            ? { created_at: anchor.created_at, snippet: anchor.snippet, from_watch_term: anchor.fromWatchTerm }
            : null,
          reason,
        },
      });
      if (insertErr) continue;
      result.notifications_created++;
      writtenForThisAgent++;
      notifiedBrandIds.add(b.id);
      brandsAlertedThisRun.add(b.id);

      const entry = bucketFor(agent);
      if (entry && entry.brands.length < BUCKET_MAX_BRANDS_PER_AGENT) {
        entry.brands.push({ id: b.id, name: b.name, slug: b.slug });
      }
    }

    // ── Listing-level alerts ───────────────────────────────────────
    for (const d of drops) {
      if (writtenForThisAgent >= perAgentLimit) break;
      if (notifiedTokens.has(d.token_id)) { result.dedup_skipped++; continue; }
      if (!audienceOk(agent.sex, d.audience)) continue;
      if (brandInSet(d.brand_slug, d.brand_name, profile.avoided)) continue;
      // Skip listings from a brand we already alerted on this run to avoid
      // sending "brand joined RRG" + "first item from that brand" as two
      // separate notifications. The owner can browse the brand page.
      if (d.brand_id && brandsAlertedThisRun.has(d.brand_id)) continue;

      const isLovedBrand = brandInSet(d.brand_slug, d.brand_name, profile.loved);
      const haystack = `${d.title} ${d.enhanced_description ?? ''} ${d.description ?? ''}`;
      const anchor = findChatAnchor(haystack, convo);
      const scored = scoreText(haystack, profile);

      // Tighter than brands: profile-only matches no longer fire for
      // listings. Per user spec, product alerts require a concrete
      // anchor (past chat / explicit watch term / loved brand).
      if (!isLovedBrand && !anchor) continue;

      // LLM relevance gate for past-chat anchors. Token overlap matches
      // "white shirt" against a black hoodie if "white" appears anywhere
      // in the listing copy. A small DeepSeek yes/no per candidate kills
      // that class of false positive. Skip for watch_term (LLM-explicit
      // already) and loved_brand (user chose the brand themselves).
      //
      // Each gate call is billed to the agent that triggered it (the
      // owner pays for their own concierge's relevance filtering), at
      // standard DeepSeek pricing + 25% platform margin. Token count
      // comes from the response usage; deduct best-effort, never fail
      // the scan on a billing hiccup.
      if (anchor && !anchor.fromWatchTerm && !isLovedBrand) {
        // Honour the per-agent weekly LLM cap. If this agent has hit
        // its cap, skip the relevance gate entirely (no LLM call, no
        // candidate). Returning silently is right: the watcher should
        // not surface a notification that would have required a paid
        // LLM call the owner has not authorised.
        const capOk = await hasCapAvailable(agent.id);
        if (!capOk) continue;

        const verdict = await llmListingMatchesRequest(
          anchor.snippet,
          d.title,
          d.brand_name,
        );
        if (verdict.tokensUsed > 0) {
          try {
            await deductCredits(agent.id, verdict.tokensUsed, 'deepseek');
          } catch (err) {
            console.error('[watcher credit deduct]', err);
          }
        }
        if (!verdict.matches) continue;
      }

      const titleQuoted = `"${d.title}"`;
      const reason = composeReason({
        itemKind: 'listing',
        itemLabel: titleQuoted,
        brandName: d.brand_name,
        anchor,
        lovedBrand: isLovedBrand,
        profileHits: scored.hits,
      });
      const url = `${SITE_URL}/rrg/drop/${d.token_id}`;
      const priceTag = d.price_usdc != null ? ` ($${d.price_usdc.toFixed(2)} USDC)` : '';
      const matchSource: 'watch_term' | 'past_chat' | 'loved_brand' | 'multi_signal' =
        anchor?.fromWatchTerm ? 'watch_term'
          : anchor ? 'past_chat'
            : isLovedBrand ? 'loved_brand'
              : 'multi_signal';

      const { error: insertErr } = await db.from('agent_notifications').insert({
        agent_id: agent.id,
        kind: 'match_found',
        title: d.brand_name ? `${d.brand_name}: ${d.title}` : d.title,
        body: `${reason}${priceTag}`,
        payload: {
          source: 'watcher',
          match_source: matchSource,
          drop_token_ids: [d.token_id],
          brand_slug: d.brand_slug,
          hits: Object.fromEntries(scored.hits),
          chat_anchor: anchor
            ? { created_at: anchor.created_at, snippet: anchor.snippet, from_watch_term: anchor.fromWatchTerm }
            : null,
          reason,
        },
      });
      if (insertErr) continue;
      result.notifications_created++;
      writtenForThisAgent++;
      notifiedTokens.add(d.token_id);

      const entry = bucketFor(agent);
      if (entry && entry.listings.length < BUCKET_MAX_LISTINGS_PER_AGENT) {
        entry.listings.push({
          tokenId: d.token_id,
          title: d.title,
          brandName: d.brand_name,
          priceUsdc: d.price_usdc,
          reason,
        });
      }
    }
  }

  // ── Pass 2: per-owner daily digest email ─────────────────────────────
  await sendOwnerDigests(ownerBuckets, result);

  return result;
}

/**
 * For each owner with at least one new match across their agents:
 *   1. Skip if a digest was already sent to this email in the last 24h.
 *   2. Merge brands across agents (dedup by brand id, union agent names).
 *   3. Merge listings across agents (dedup by token id, union agent names).
 *   4. Send one cream/serif digest email.
 *   5. Record the send as a `daily_owner_digest` notification row, scoped
 *      to one of the matched agents (the row needs an agent_id) so the
 *      24h cap query tomorrow finds it.
 */
async function sendOwnerDigests(
  buckets: Map<string, OwnerBucket>,
  result: ScanResult,
): Promise<void> {
  if (buckets.size === 0) return;

  const cooldownSince = new Date(
    Date.now() - OWNER_EMAIL_COOLDOWN_HOURS * 3600 * 1000,
  ).toISOString();

  for (const bucket of buckets.values()) {
    if (!bucket.email) {
      result.owners_with_no_email++;
      continue;
    }

    // Flatten + dedup across agents.
    const brandMap = new Map<string, DigestBrand & { brandId: string }>();
    const listingMap = new Map<number, DigestListing>();
    const matchedAgentIds = new Set<string>();
    const matchedAgentNames = new Set<string>();

    for (const entry of bucket.agents.values()) {
      for (const b of entry.brands) {
        const existing = brandMap.get(b.id);
        if (existing) {
          if (!existing.matchedAgentNames.includes(entry.agentName)) {
            existing.matchedAgentNames.push(entry.agentName);
          }
        } else {
          brandMap.set(b.id, {
            brandId: b.id,
            name: b.name,
            url: `${SITE_URL}/brand/${b.slug}`,
            matchedAgentNames: [entry.agentName],
          });
        }
      }
      for (const l of entry.listings) {
        const existing = listingMap.get(l.tokenId);
        if (existing) {
          if (!existing.matchedAgentNames.includes(entry.agentName)) {
            existing.matchedAgentNames.push(entry.agentName);
          }
        } else {
          listingMap.set(l.tokenId, {
            title: l.title,
            brandName: l.brandName,
            url: `${SITE_URL}/rrg/drop/${l.tokenId}`,
            priceUsdc: l.priceUsdc,
            reason: l.reason,
            matchedAgentNames: [entry.agentName],
          });
        }
      }
      if (entry.brands.length > 0 || entry.listings.length > 0) {
        matchedAgentIds.add(entry.agentId);
        matchedAgentNames.add(entry.agentName);
      }
    }

    if (brandMap.size === 0 && listingMap.size === 0) continue;

    // Per-owner 24h cap. We pull any daily_owner_digest row for any of
    // this owner's matched agents and inspect the payload's owner_email.
    // Cheaper than a JSON predicate scan, and gives us the audit trail
    // when we insert the new row below.
    const { data: priorDigests } = await db
      .from('agent_notifications')
      .select('id, payload, created_at')
      .in('agent_id', Array.from(matchedAgentIds))
      .eq('kind', 'daily_owner_digest')
      .gte('created_at', cooldownSince);

    const ownerKey = bucket.email.trim().toLowerCase();
    const alreadySent = (priorDigests ?? []).some(r => {
      const p = r.payload as { owner_email?: string } | null;
      return p?.owner_email?.toLowerCase() === ownerKey;
    });
    if (alreadySent) {
      result.owners_capped_today++;
      continue;
    }

    const payload: DigestPayload = {
      brands: Array.from(brandMap.values()).map(({ brandId: _drop, ...rest }) => rest),
      listings: Array.from(listingMap.values()),
    };

    try {
      await sendOwnerDailyDigest(bucket.email, payload);
      result.emails_sent++;
      result.owners_emailed++;

      // Record the send under one of the matched agents so it shows up
      // in tomorrow's cap query.
      const auditAgentId = matchedAgentIds.values().next().value;
      if (auditAgentId) {
        await db.from('agent_notifications').insert({
          agent_id: auditAgentId,
          kind: 'daily_owner_digest',
          title: 'Daily digest sent',
          body: `Sent to ${bucket.email}: ${payload.brands.length} brands, ${payload.listings.length} listings.`,
          payload: {
            source: 'watcher',
            owner_email: bucket.email,
            agent_ids: Array.from(matchedAgentIds),
            agent_names: Array.from(matchedAgentNames),
            brand_ids: Array.from(brandMap.keys()),
            listing_token_ids: Array.from(listingMap.keys()),
            sent_at: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      console.error('[watcher digest send]', err);
    }
  }
}
