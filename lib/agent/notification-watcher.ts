/**
 * Relevance-match watcher for the personal Concierge.
 *
 * Twice the surface area of the first cut:
 *   1. Newly approved listings from the last 24h, scored against each
 *      pro-tier agent's full profile.
 *   2. New brands that became active on RRG in the last 24h, scored
 *      against the same profile.
 *
 * Stricter matching than v1. A listing or brand counts as a match if:
 *   - The brand is in the owner's loved-brand set (and not avoided), OR
 *   - Its text hits AT LEAST 2 DISTINCT signal axes drawn from the owner's
 *     style_tags, interest_categories, persona_bio + free_instructions,
 *     and learned agent_memory facts (excluding pure brand memories,
 *     which feed the loved/avoided sets above).
 *
 * One style_tag substring is no longer enough on its own. The point is:
 * an email only fires when something genuinely lines up with the agent's
 * profile, not on a single keyword coincidence.
 *
 * Per match: one in-app notification row AND one email. No digests, no
 * bundling. The per-agent cap (default 5 across listings + brands) keeps
 * a single scan from flooding the inbox if the signals get noisy.
 *
 * Audience: a male owner skips women-only listings, female owner skips
 * men-only, unisex/unknown always passes.
 */

import { db } from '@/lib/rrg/db';
import type { AgentMemory } from './memory';
import { sendNewListingMatch, sendNewBrandMatch } from './email';

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

export async function runDropMatchScan(opts: ScanOpts = {}): Promise<ScanResult> {
  const hoursBack = opts.hoursBack ?? 24;
  const perAgentLimit = opts.perAgentLimit ?? 5;
  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  const result: ScanResult = {
    agents_scanned: 0,
    listings_considered: 0,
    brands_considered: 0,
    notifications_created: 0,
    emails_sent: 0,
    dedup_skipped: 0,
  };

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

    let writtenForThisAgent = 0;
    const brandsAlertedThisRun = new Set<string>();

    // ── Brand-level alerts first (rarer, higher signal) ─────────────
    for (const b of newBrands) {
      if (writtenForThisAgent >= perAgentLimit) break;
      if (notifiedBrandIds.has(b.id)) { result.dedup_skipped++; continue; }
      if (brandInSet(b.slug, b.name, profile.avoided)) continue;

      const isLoved = brandInSet(b.slug, b.name, profile.loved);
      let scored: { sources: string[]; hits: Map<string, string[]> } = { sources: [], hits: new Map() };

      if (!isLoved) {
        const bd = b.brand_data ?? {};
        const parts: string[] = [b.name];
        for (const key of ['tagline', 'description', 'bio', 'story', 'about', 'mission']) {
          const v = bd[key];
          if (typeof v === 'string') parts.push(v);
        }
        scored = scoreText(parts.join(' '), profile);
        if (scored.sources.length < 2) continue;
      }

      const reason = isLoved
        ? `${b.name} is on your brand list and just joined RRG.`
        : `${b.name} joined RRG and lines up with your ${summariseSignals(scored.hits)}.`;
      const brandUrl = `${SITE_URL}/brand/${b.slug}`;

      const { error: insertErr } = await db.from('agent_notifications').insert({
        agent_id: agent.id,
        kind: 'brand_match_found',
        title: `${b.name} on RRG`,
        body: reason,
        payload: {
          source: 'watcher',
          match_source: isLoved ? 'loved_brand' : 'multi_signal',
          brand_id: b.id,
          brand_slug: b.slug,
          hits: Object.fromEntries(scored.hits),
          reason,
        },
      });
      if (insertErr) continue;
      result.notifications_created++;
      writtenForThisAgent++;
      notifiedBrandIds.add(b.id);
      brandsAlertedThisRun.add(b.id);

      if (agent.email) {
        try {
          await sendNewBrandMatch(agent.email, agent.name, {
            brandName: b.name,
            brandUrl,
            reason,
          });
          result.emails_sent++;
        } catch (err) {
          console.error('[watcher email brand]', err);
        }
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
      let scored: { sources: string[]; hits: Map<string, string[]> } = { sources: [], hits: new Map() };

      if (!isLovedBrand) {
        const haystack = `${d.title} ${d.enhanced_description ?? ''} ${d.description ?? ''}`;
        scored = scoreText(haystack, profile);
        if (scored.sources.length < 2) continue;
      }

      const reason = isLovedBrand
        ? `${d.brand_name ?? d.brand_slug} is on your brand list. New listing: "${d.title}".`
        : `"${d.title}"${d.brand_name ? ` by ${d.brand_name}` : ''} lines up with your ${summariseSignals(scored.hits)}.`;
      const url = `${SITE_URL}/rrg/drop/${d.token_id}`;
      const priceTag = d.price_usdc != null ? ` ($${d.price_usdc.toFixed(2)} USDC)` : '';

      const { error: insertErr } = await db.from('agent_notifications').insert({
        agent_id: agent.id,
        kind: 'match_found',
        title: d.brand_name ? `${d.brand_name}: ${d.title}` : d.title,
        body: `${reason}${priceTag}`,
        payload: {
          source: 'watcher',
          match_source: isLovedBrand ? 'loved_brand' : 'multi_signal',
          drop_token_ids: [d.token_id],
          brand_slug: d.brand_slug,
          hits: Object.fromEntries(scored.hits),
          reason,
        },
      });
      if (insertErr) continue;
      result.notifications_created++;
      writtenForThisAgent++;
      notifiedTokens.add(d.token_id);

      if (agent.email) {
        try {
          await sendNewListingMatch(agent.email, agent.name, {
            brandName: d.brand_name,
            title: d.title,
            url,
            priceUsdc: d.price_usdc,
            reason,
          });
          result.emails_sent++;
        } catch (err) {
          console.error('[watcher email listing]', err);
        }
      }
    }
  }

  return result;
}
