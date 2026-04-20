/**
 * Matches newly-created or updated Personal Shoppers / Concierges against
 * active brands and writes agent_brand_preferences rows. These rows feed
 * the via-brand-onboarding credit engine's "brand_preference" threshold.
 *
 * Three match types:
 *   - explicit_mention: agent's persona/bio/instructions name the brand
 *   - category_match: agent's interest_categories overlap with brand's category
 *   - aesthetic_match: agent's style_tags overlap with brand's aesthetic
 *
 * Fire-and-forget from the create and update handlers.
 */

import { db } from './db';

interface AgentProfile {
  erc8004_agent_id?: number | null;
  id: string;
  style_tags?: string[] | null;
  interest_categories?: Array<{ category: string; tags?: string[] }> | null;
  free_instructions?: string | null;
  persona_bio?: string | null;
  persona_voice?: string | null;
}

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  brand_data: Record<string, unknown> | null;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasExplicitMention(agent: AgentProfile, brand: BrandRow): boolean {
  const haystack = normalise(
    [agent.free_instructions, agent.persona_bio, agent.persona_voice]
      .filter(Boolean)
      .join(' '),
  );
  if (!haystack) return false;
  const needle = normalise(brand.name);
  if (!needle) return false;
  return haystack.includes(needle);
}

function hasCategoryMatch(agent: AgentProfile, brand: BrandRow): boolean {
  if (!brand.category) return false;
  const interests = agent.interest_categories ?? [];
  const brandCat = brand.category.toLowerCase();
  return interests.some(
    (ic) =>
      ic.category?.toLowerCase() === brandCat ||
      ic.category?.toLowerCase().replace(/_/g, ' ') === brandCat.replace(/_/g, ' '),
  );
}

function hasAestheticMatch(agent: AgentProfile, brand: BrandRow): boolean {
  const tags = (agent.style_tags ?? []).map((t) => normalise(t));
  if (tags.length === 0) return false;
  const aesthetic = typeof brand.brand_data?.aesthetic === 'string'
    ? normalise(brand.brand_data.aesthetic as string)
    : '';
  if (!aesthetic) return false;
  return tags.some((tag) => tag.length > 2 && aesthetic.includes(tag));
}

export async function matchAgentAgainstBrands(
  agent: AgentProfile,
): Promise<{ matches: number }> {
  if (!agent.erc8004_agent_id) {
    return { matches: 0 };
  }

  const { data: brands, error } = await db
    .from('rrg_brands')
    .select('id, name, slug, category, brand_data')
    .in('onboarding_status', ['approved', 'live'])
    .eq('status', 'active');

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[agent-brand-match] brands lookup failed:', error.message);
    return { matches: 0 };
  }

  let matches = 0;
  for (const raw of brands ?? []) {
    const brand = raw as unknown as BrandRow;
    const toInsert: Array<{ match_type: string }> = [];

    if (hasExplicitMention(agent, brand)) toInsert.push({ match_type: 'explicit_mention' });
    if (hasCategoryMatch(agent, brand)) toInsert.push({ match_type: 'category_match' });
    if (hasAestheticMatch(agent, brand)) toInsert.push({ match_type: 'aesthetic_match' });

    for (const m of toInsert) {
      await db
        .from('agent_brand_preferences')
        .upsert(
          {
            agent_id: agent.erc8004_agent_id,
            brand_id: brand.id,
            match_type: m.match_type,
          },
          { onConflict: 'agent_id,brand_id,match_type' },
        );
      matches += 1;
    }
  }

  return { matches };
}

export function queueAgentBrandMatch(agent: AgentProfile): void {
  // Fire and forget: agent creation mustn't block on this.
  void (async () => {
    try {
      await matchAgentAgainstBrands(agent);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[agent-brand-match] failed:', err);
    }
  })();
}
