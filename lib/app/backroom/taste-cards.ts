/**
 * Taste Cards: the shareable face of a taste profile.
 *
 * A card is a human-curated, publish-opt-in SNAPSHOT of the private taste
 * profile. The privacy ladder is strict:
 *
 *   full profile  (app_taste_profiles, service-role only, never public)
 *   > card        (this module: the subset the member picked, capped)
 *   > teaser      (anonymised sketch on the NOSTR rail, keyed by an opaque
 *                  teaser_d, never the slug, name or ref)
 *
 * voice_text never appears on a card; the card carries a human-written
 * headline instead. Saving validates that every curated entry exists in the
 * member's active profile, so a card is provably a subset of what the human
 * declared. Publishing is the single consent gate: page + image + JSON go
 * live together, and matching enrolment follows the separate toggle.
 */
import { db } from '../db';
import { getActiveProfile, type MemberPlatform, type MemberType } from './taste';
import { resolveRrgBrand, resolveRrgConcierge } from './rrg-federation';

export interface CardMember {
  member_platform: MemberPlatform;
  member_type:     MemberType;
  member_ref:      string;
}

export interface AgentIdentity {
  mcp_url:          string | null;
  erc8004_agent_id: string | null;
  agent_wallet:     string | null;
}

export interface TasteCard {
  id:               string;
  member_platform:  MemberPlatform;
  member_type:      MemberType;
  member_ref:       string;
  slug:             string;
  status:           'draft' | 'published';
  display_name:     string;
  headline:         string;
  accent:           string;
  references:       string[];
  obsessions:       string[];
  anti_references:  string[];
  vocab:            string[];
  profile_version:  number | null;
  matching_enabled: boolean;
  teaser_d:         string;
  agent_identity:   AgentIdentity;
  published_at:     string | null;
}

export interface CardInput {
  slug?:             string;
  display_name?:     string;
  headline?:         string;
  accent?:           string;
  references?:       string[];
  obsessions?:       string[];
  anti_references?:  string[];
  vocab?:            string[];
  matching_enabled?: boolean;
}

export type SaveCardResult =
  | { ok: true; card: TasteCard }
  | { ok: false; error: string };

/** Display caps: a card is a face, not the archive. */
export const CARD_CAPS = { references: 7, obsessions: 5, anti_references: 5, vocab: 6 } as const;
const HEADLINE_MAX = 140;

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'backroom', 'buyer', 'buyers', 'card', 'cards', 'door',
  'events', 'faq', 'mcp', 'new', 'room', 'rooms', 'seller', 'sellers', 'taste',
  'via', 'world', 'you',
]);

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.getvia.xyz').replace(/\/$/, '');

const SELECT_COLS =
  'id, member_platform, member_type, member_ref, slug, status, display_name, headline, accent, ' +
  'card_references, card_obsessions, card_anti_references, card_vocab, ' +
  'profile_version, matching_enabled, teaser_d, agent_identity, published_at';

function asStrings(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, cap);
}

function rowToCard(d: Record<string, unknown>): TasteCard {
  const identity = (d.agent_identity ?? {}) as Partial<AgentIdentity>;
  return {
    id: String(d.id),
    member_platform: d.member_platform as MemberPlatform,
    member_type: d.member_type as MemberType,
    member_ref: String(d.member_ref),
    slug: String(d.slug),
    status: d.status === 'published' ? 'published' : 'draft',
    display_name: String(d.display_name ?? ''),
    headline: String(d.headline ?? ''),
    accent: String(d.accent ?? '#8a5a3c'),
    references: asStrings(d.card_references, CARD_CAPS.references),
    obsessions: asStrings(d.card_obsessions, CARD_CAPS.obsessions),
    anti_references: asStrings(d.card_anti_references, CARD_CAPS.anti_references),
    vocab: asStrings(d.card_vocab, CARD_CAPS.vocab),
    profile_version: d.profile_version == null ? null : Number(d.profile_version),
    matching_enabled: d.matching_enabled !== false,
    teaser_d: String(d.teaser_d),
    agent_identity: {
      mcp_url: (identity.mcp_url ?? null) as string | null,
      erc8004_agent_id: (identity.erc8004_agent_id ?? null) as string | null,
      agent_wallet: (identity.agent_wallet ?? null) as string | null,
    },
    published_at: d.published_at == null ? null : String(d.published_at),
  };
}

export async function getCardForMember(platform: MemberPlatform, memberType: MemberType, memberRef: string): Promise<TasteCard | null> {
  const { data } = await db
    .from('app_taste_cards')
    .select(SELECT_COLS)
    .eq('member_platform', platform)
    .eq('member_type', memberType)
    .eq('member_ref', memberRef)
    .maybeSingle();
  return data ? rowToCard(data as unknown as Record<string, unknown>) : null;
}

export async function getPublishedCardBySlug(slug: string): Promise<TasteCard | null> {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const { data } = await db
    .from('app_taste_cards')
    .select(SELECT_COLS)
    .eq('slug', s)
    .eq('status', 'published')
    .maybeSingle();
  return data ? rowToCard(data as unknown as Record<string, unknown>) : null;
}

/** Every published card enrolled in matching. The matcher cron's corpus: all
 *  four member kinds, read locally (RRG members' cards live in VIA tables). */
export async function listMatchableCards(): Promise<TasteCard[]> {
  const { data } = await db
    .from('app_taste_cards')
    .select(SELECT_COLS)
    .eq('status', 'published')
    .eq('matching_enabled', true)
    .order('created_at', { ascending: true });
  return ((data as unknown as Record<string, unknown>[]) ?? []).map(rowToCard);
}

/**
 * Published card slugs for a set of members in one query, keyed
 * `platform/type/ref`. The room view uses this to link member chips to cards
 * without a per-member round trip.
 */
export async function publishedCardSlugsFor(members: CardMember[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const refs = Array.from(new Set(members.map((m) => m.member_ref))).filter(Boolean);
  if (!refs.length) return out;
  const { data } = await db
    .from('app_taste_cards')
    .select('member_platform, member_type, member_ref, slug')
    .eq('status', 'published')
    .in('member_ref', refs);
  const wanted = new Set(members.map((m) => `${m.member_platform}/${m.member_type}/${m.member_ref}`));
  for (const r of ((data as Record<string, string>[]) ?? [])) {
    const key = `${r.member_platform}/${r.member_type}/${r.member_ref}`;
    if (wanted.has(key)) out.set(key, r.slug);
  }
  return out;
}

/** Published card for a member, or null. The room/door surfaces use this to link cards. */
export async function getPublishedCardForMember(platform: MemberPlatform, memberType: MemberType, memberRef: string): Promise<TasteCard | null> {
  const card = await getCardForMember(platform, memberType, memberRef);
  return card && card.status === 'published' ? card : null;
}

export async function isSlugAvailable(slug: string, forMember?: CardMember): Promise<boolean> {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s) || RESERVED_SLUGS.has(s)) return false;
  const { data } = await db
    .from('app_taste_cards')
    .select('member_platform, member_type, member_ref')
    .eq('slug', s)
    .maybeSingle();
  if (!data) return true;
  const d = data as Record<string, string>;
  return !!forMember
    && d.member_platform === forMember.member_platform
    && d.member_type === forMember.member_type
    && d.member_ref === forMember.member_ref;
}

/** A free slug derived from the member ref: the ref itself, else ref-2, ref-3... */
export async function suggestSlug(memberRef: string, forMember?: CardMember): Promise<string> {
  const base = memberRef.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'member';
  const padded = base.length >= 3 ? base : `${base}-card`.slice(0, 34);
  if (await isSlugAvailable(padded, forMember)) return padded;
  for (let n = 2; n < 50; n++) {
    const candidate = `${padded}-${n}`;
    if (await isSlugAvailable(candidate, forMember)) return candidate;
  }
  return `${padded}-${Date.now().toString(36)}`;
}

/**
 * Snapshot the member's agent identity onto the card: the address another
 * human or agent can reach them at. Best-effort; a card renders without it.
 */
async function resolveAgentIdentity(member: CardMember): Promise<{ identity: AgentIdentity; displayName: string }> {
  const empty: AgentIdentity = { mcp_url: null, erc8004_agent_id: null, agent_wallet: null };
  const { member_platform: platform, member_type: type, member_ref: ref } = member;
  try {
    if (platform === 'via' && type === 'buyer') {
      const { data } = await db
        .from('app_buyers')
        .select('display_name, erc8004_agent_id, agent_wallet_address, wallet_address')
        .eq('handle', ref)
        .maybeSingle();
      const d = (data ?? {}) as Record<string, unknown>;
      return {
        identity: {
          mcp_url: `${APP_BASE}/buyers/${ref}/mcp`,
          erc8004_agent_id: (d.erc8004_agent_id ?? null) as string | null,
          agent_wallet: (d.agent_wallet_address ?? d.wallet_address ?? null) as string | null,
        },
        displayName: String(d.display_name ?? '') || ref,
      };
    }
    if (platform === 'via' && type === 'seller') {
      const { data } = await db
        .from('app_sellers')
        .select('name, erc8004_agent_id, agent_wallet_address')
        .eq('slug', ref)
        .maybeSingle();
      const d = (data ?? {}) as Record<string, unknown>;
      return {
        identity: {
          mcp_url: `${APP_BASE}/sellers/${ref}/mcp`,
          erc8004_agent_id: (d.erc8004_agent_id ?? null) as string | null,
          agent_wallet: (d.agent_wallet_address ?? null) as string | null,
        },
        displayName: String(d.name ?? '') || ref,
      };
    }
    if (platform === 'rrg' && type === 'seller') {
      const brand = await resolveRrgBrand(ref);
      return {
        identity: { mcp_url: brand?.mcp_url ?? null, erc8004_agent_id: null, agent_wallet: brand?.wallet_address ?? null },
        displayName: brand?.name || ref,
      };
    }
    const concierge = await resolveRrgConcierge(ref);
    return {
      identity: { mcp_url: null, erc8004_agent_id: null, agent_wallet: concierge?.wallet_address ?? null },
      displayName: concierge?.name || ref,
    };
  } catch {
    return { identity: empty, displayName: ref };
  }
}

/**
 * Keep only curated entries that exist in the active profile (case-insensitive),
 * preserving the member's chosen order. This is what makes the card provably a
 * subset of the human-declared profile.
 */
function subsetOf(curated: string[], declared: string[], cap: number): string[] {
  const declaredSet = new Set(declared.map((s) => s.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of curated) {
    const entry = String(raw).trim();
    const key = entry.toLowerCase();
    if (!entry || seen.has(key) || !declaredSet.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Create or update the member's card (upsert on the member triple). Curation
 * only: publishing is a separate, explicit act (publishCard).
 */
export async function saveCard(member: CardMember, input: CardInput): Promise<SaveCardResult> {
  const profile = await getActiveProfile(member.member_platform, member.member_type, member.member_ref);
  if (!profile) return { ok: false, error: 'no active taste profile: finish the interview or save your profile first' };

  const existing = await getCardForMember(member.member_platform, member.member_type, member.member_ref);

  let slug = (input.slug ?? existing?.slug ?? '').trim().toLowerCase();
  if (!slug) slug = await suggestSlug(member.member_ref, member);
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'slug must be 3 to 40 characters, lowercase letters, numbers and hyphens' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: 'that slug is reserved' };
  if (!(await isSlugAvailable(slug, member))) return { ok: false, error: 'that slug is taken' };

  const accent = (input.accent ?? existing?.accent ?? '#8a5a3c').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return { ok: false, error: 'accent must be a hex colour like #8a5a3c' };

  const { identity, displayName } = await resolveAgentIdentity(member);

  const row = {
    member_platform: member.member_platform,
    member_type: member.member_type,
    member_ref: member.member_ref,
    slug,
    display_name: (input.display_name ?? existing?.display_name ?? '').trim().slice(0, 80) || displayName,
    headline: (input.headline ?? existing?.headline ?? '').trim().slice(0, HEADLINE_MAX),
    accent,
    card_references: subsetOf(input.references ?? existing?.references ?? [], profile.references, CARD_CAPS.references),
    card_obsessions: subsetOf(input.obsessions ?? existing?.obsessions ?? [], profile.obsessions, CARD_CAPS.obsessions),
    card_anti_references: subsetOf(input.anti_references ?? existing?.anti_references ?? [], profile.anti_references, CARD_CAPS.anti_references),
    card_vocab: subsetOf(input.vocab ?? existing?.vocab ?? [], profile.aesthetic_vocab, CARD_CAPS.vocab),
    profile_version: profile.version,
    matching_enabled: input.matching_enabled ?? existing?.matching_enabled ?? true,
    agent_identity: identity,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('app_taste_cards')
    .upsert(row, { onConflict: 'member_platform,member_type,member_ref' })
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, card: rowToCard(data as unknown as Record<string, unknown>) };
}

export type PublishResult =
  | { ok: true; card: TasteCard }
  | { ok: false; error: string };

/** The consent gate: page, image and JSON go live together. */
export async function publishCard(member: CardMember): Promise<PublishResult> {
  const card = await getCardForMember(member.member_platform, member.member_type, member.member_ref);
  if (!card) return { ok: false, error: 'no card to publish: save the card first' };
  const hasContent = card.references.length || card.obsessions.length || card.anti_references.length || card.vocab.length;
  if (!hasContent) return { ok: false, error: 'the card is empty: pick at least one entry before publishing' };

  const { data, error } = await db
    .from('app_taste_cards')
    .update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', card.id)
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  const published = rowToCard(data as unknown as Record<string, unknown>);
  await fireTeaser(published, 'open');
  return { ok: true, card: published };
}

export async function unpublishCard(member: CardMember): Promise<PublishResult> {
  const card = await getCardForMember(member.member_platform, member.member_type, member.member_ref);
  if (!card) return { ok: false, error: 'no card' };
  const { data, error } = await db
    .from('app_taste_cards')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', card.id)
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  const draft = rowToCard(data as unknown as Record<string, unknown>);
  await fireTeaser(draft, 'closed');
  return { ok: true, card: draft };
}

/**
 * Best-effort taste teaser on the open rail. Publishing opens it, unpublishing
 * closes it; matching_enabled=false publishes the card WITHOUT a teaser (the
 * page is public but the member is not in the matcher corpus).
 */
async function fireTeaser(card: TasteCard, status: 'open' | 'closed'): Promise<void> {
  if (status === 'open' && !card.matching_enabled) return;
  try {
    const { publishTasteTeaserToNostr } = await import('../broadcast/nostr');
    await publishTasteTeaserToNostr(card, status);
  } catch (e) {
    console.warn(`[taste-cards] teaser ${status} failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

export function cardUrl(card: Pick<TasteCard, 'slug'>): string {
  return `${APP_BASE}/taste/${card.slug}`;
}

/** The agent-readable shape served at /api/taste/[slug] and by get_taste_card. */
export function cardJson(card: TasteCard): Record<string, unknown> {
  return {
    v: 'via-taste-card-1',
    slug: card.slug,
    display_name: card.display_name,
    headline: card.headline,
    member_kind: card.member_type,
    references: card.references,
    obsessions: card.obsessions,
    anti_references: card.anti_references,
    vocab: card.vocab,
    agent: {
      mcp_url: card.agent_identity.mcp_url,
      erc8004_agent_id: card.agent_identity.erc8004_agent_id,
    },
    knock: {
      url: `${cardUrl(card)}`,
      note: 'A signed-in VIA member with a published card can knock to request an introduction.',
    },
  };
}
