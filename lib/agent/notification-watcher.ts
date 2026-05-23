/**
 * Drop-match watcher.
 *
 * Scans recently-approved rrg_submissions against each pro-tier agent's
 * memory (loved brands, style keywords) and writes match_found rows into
 * agent_notifications. One notification per (agent, drop). Dedupes against
 * existing watcher rows in the last 30 days.
 *
 * Designed to be called on a cron (Vercel cron / external cron / scheduled
 * task) via /api/rrg/admin/agent-notifications/scan.
 *
 * Match heuristics are intentionally simple for the first cut:
 *  1. brand match: drop's brand_slug is named in a memory of type 'brand'
 *                  that does not start with "Avoids " (case-insensitive).
 *  2. style match: drop title OR enhanced_description contains any of the
 *                  owner's style_tags (case-insensitive whole-word).
 *
 * Audience: a male owner skips women-only drops, female owner skips men-only,
 * unisex/unknown always passes. Same rule the chat search applies.
 */

import { db } from '@/lib/rrg/db';
import type { AgentMemory } from './memory';
import { sendMatchDigest } from './email';

interface AgentRow {
  id: string;
  name: string;
  email: string | null;
  tier: string;
  style_tags: string[] | null;
  sex: 'male' | 'female' | 'other' | null;
  status: string;
  llm_provider: string | null;
}

interface MatchForDigest {
  title: string;
  brandName: string | null;
  url: string;
  priceUsdc: number | null;
  reason: string;
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

interface ScanOpts {
  /** Look back this many hours for newly-approved drops. Default 24. */
  hoursBack?: number;
  /** Per-agent cap on notifications written in one scan. Prevents a single
   *  re-import of a brand from spamming the dashboard. Default 5. */
  perAgentLimit?: number;
}

interface ScanResult {
  agents_scanned: number;
  drops_considered: number;
  notifications_created: number;
  dedup_skipped: number;
  digests_sent: number;
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

function tokenizeStyleTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
}

function buildBrandMatchSet(memories: AgentMemory[]): Set<string> {
  const liked = new Set<string>();
  for (const m of memories) {
    if (m.type !== 'brand') continue;
    if (!m.active) continue;
    const content = m.content.toLowerCase();
    if (content.startsWith('avoids ')) continue;
    const match = content.match(/(?:likes|loves|liked)\s+([a-z0-9 \-_]+?)(?:\s*\(set at signup\))?$/);
    if (match) liked.add(match[1].trim());
    const firstWord = content.split(/\s+/)[0];
    if (firstWord && firstWord.length > 2) liked.add(firstWord);
  }
  return liked;
}

function styleMatches(haystack: string, styleTokens: string[]): string | null {
  const h = haystack.toLowerCase();
  for (const t of styleTokens) {
    if (!t) continue;
    if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`).test(h)) {
      return t;
    }
  }
  return null;
}

function audienceOk(ownerSex: AgentRow['sex'], dropAudience: string | null): boolean {
  if (!ownerSex) return true;
  if (!dropAudience) return true;
  const a = dropAudience.toLowerCase();
  if (a === 'unisex' || a === 'unknown') return true;
  if (ownerSex === 'male' && a === 'women') return false;
  if (ownerSex === 'female' && a === 'men') return false;
  return true;
}

export async function runDropMatchScan(opts: ScanOpts = {}): Promise<ScanResult> {
  const hoursBack = opts.hoursBack ?? 24;
  const perAgentLimit = opts.perAgentLimit ?? 5;
  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  const result: ScanResult = {
    agents_scanned: 0,
    drops_considered: 0,
    notifications_created: 0,
    dedup_skipped: 0,
    digests_sent: 0,
  };

  const { data: agents, error: agentsErr } = await db
    .from('agent_agents')
    .select('id, name, email, tier, style_tags, sex, status, llm_provider')
    .eq('tier', 'pro')
    .eq('status', 'active');

  if (agentsErr || !agents) return result;

  const { data: rawDrops, error: dropsErr } = await db
    .from('rrg_submissions')
    .select('token_id, title, enhanced_description, description, audience, brand_id, approved_at, price_usdc')
    .eq('status', 'approved')
    .eq('hidden', false)
    .gte('approved_at', since)
    .order('approved_at', { ascending: false })
    .limit(500);

  if (dropsErr || !rawDrops || rawDrops.length === 0) {
    result.agents_scanned = agents.length;
    return result;
  }

  const brandIds = Array.from(new Set(rawDrops.map(d => d.brand_id).filter((b): b is string => !!b)));
  const { data: brandRows } = brandIds.length > 0
    ? await db.from('rrg_brands').select('id, slug, name').in('id', brandIds)
    : { data: [] };
  const brandMap = new Map<string, { slug: string; name: string }>(
    (brandRows ?? []).map(b => [b.id as string, { slug: b.slug as string, name: b.name as string }]),
  );

  const drops: DropRow[] = rawDrops.map(d => ({
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

  result.drops_considered = drops.length;

  for (const agent of agents as AgentRow[]) {
    result.agents_scanned++;

    const { data: mems } = await db
      .from('agent_memory')
      .select('id, type, content, active, source_session_id, agent_id, created_at, superseded_by')
      .eq('agent_id', agent.id)
      .eq('active', true);
    const memories = (mems ?? []) as AgentMemory[];
    const likedBrandTokens = buildBrandMatchSet(memories);

    const styleTokens = (agent.style_tags ?? []).map(tokenizeStyleTag).filter(Boolean);

    if (likedBrandTokens.size === 0 && styleTokens.length === 0) continue;

    const dedupeSince = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const { data: existing } = await db
      .from('agent_notifications')
      .select('payload')
      .eq('agent_id', agent.id)
      .eq('kind', 'match_found')
      .gte('created_at', dedupeSince);
    const alreadyNotified = new Set<number>();
    for (const row of existing ?? []) {
      const ids = (row.payload as { drop_token_ids?: number[] } | null)?.drop_token_ids;
      if (Array.isArray(ids)) ids.forEach(id => alreadyNotified.add(id));
    }

    let writtenForThisAgent = 0;
    const digestMatches: MatchForDigest[] = [];
    for (const d of drops) {
      if (writtenForThisAgent >= perAgentLimit) break;
      if (alreadyNotified.has(d.token_id)) {
        result.dedup_skipped++;
        continue;
      }
      if (!audienceOk(agent.sex, d.audience)) continue;

      const brandSlug = d.brand_slug?.toLowerCase() ?? '';
      const brandName = d.brand_name?.toLowerCase() ?? '';
      let reason: string | null = null;

      if (brandSlug && likedBrandTokens.has(brandSlug)) {
        reason = `New drop from ${d.brand_name ?? d.brand_slug}, a brand you've told me you like.`;
      } else if (brandName && likedBrandTokens.has(brandName.split(/\s+/)[0])) {
        reason = `New drop from ${d.brand_name}, a brand you've told me you like.`;
      } else {
        const haystack = `${d.title} ${d.enhanced_description ?? ''} ${d.description ?? ''}`;
        const hit = styleMatches(haystack, styleTokens);
        if (hit) {
          reason = `Matches your "${hit}" style: "${d.title}" by ${d.brand_name ?? 'unknown'}.`;
        }
      }

      if (!reason) continue;

      const priceTag = d.price_usdc != null ? ` ($${d.price_usdc.toFixed(2)} USDC)` : '';
      const { error: insertErr } = await db.from('agent_notifications').insert({
        agent_id: agent.id,
        kind: 'match_found',
        title: d.brand_name ? `New from ${d.brand_name}: ${d.title}` : `New on VIA: ${d.title}`,
        body: `${reason}${priceTag}`,
        payload: {
          source: 'watcher',
          drop_token_ids: [d.token_id],
          brand_slug: d.brand_slug,
          reason,
        },
      });
      if (!insertErr) {
        result.notifications_created++;
        writtenForThisAgent++;
        alreadyNotified.add(d.token_id);
        digestMatches.push({
          title: d.title,
          brandName: d.brand_name,
          url: `${SITE_URL}/rrg/drop/${d.token_id}`,
          priceUsdc: d.price_usdc,
          reason,
        });
      }
    }

    // Email digest. Sent only on days with matches, only once per agent
    // per scan run. No row in agent_agents has an unsubscribe flag yet;
    // first matches in days are rare enough that this stays below the
    // "spammy" threshold. If volume grows we'll add notify_email_enabled.
    if (digestMatches.length > 0 && agent.email) {
      try {
        await sendMatchDigest(agent.email, agent.name, digestMatches);
        result.digests_sent++;
      } catch (err) {
        console.error('[watcher email]', err);
      }
    }
  }

  return result;
}
