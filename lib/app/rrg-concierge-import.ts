/**
 * Import an RRG personal concierge into a VIA buying agent, and keep its
 * learned memories in sync.
 *
 * RRG exposes a concierge's persona at GET /api/agent/[id] and its memories at
 * GET /api/agent/[id]/memory. via-app already federates to RRG over HTTP
 * (lib/app/network-stats.ts). This module pulls those, creates (or re-links) an
 * app_buyers row keyed to the SAME funding wallet, mints the buyer's own
 * platform-derived ERC-8004 identity (it never reuses the RRG signing wallet ,
 * see lib/app/buyer-identity.ts), seeds app_buyer_memories, and grants the
 * standard welcome credits.
 *
 * "The same details" = funding wallet + persona + memories. The signing
 * identity is necessarily new (VIA invariant). The link is stored on
 * app_buyers.linked_rrg_agent_id for provenance + as the sync key.
 */
import { db } from './db';
import { mintBuyerIdentity } from './buyer-identity';
import { deriveAgentWallet, platformAgentWalletsEnabled } from './agent-wallet';
import { grantWelcomeCredits } from './buyer-credits';
import { syntheticTestAgentId } from './test-mode';
import type { BuyerMemoryType } from './buying-agent';

const RRG_BASE = process.env.RRG_BASE_URL ?? 'https://realrealgenuine.com';
const EXTERNAL_SOURCE = 'rrg';

// ── RRG payload shapes (only the fields we read) ──────────────────────

interface RrgAgent {
  id: string;
  name: string | null;
  wallet_address: string | null;
  persona_bio: string | null;
  style_tags: string[] | null;
  free_instructions: string | null;
  budget_ceiling_usdc: number | string | null;
  erc8004_agent_id: string | null;
}

interface RrgMemory {
  id: string;
  type: 'preference' | 'brand' | 'style' | 'size' | 'general' | 'consolidated';
  content: string;
  active: boolean;
}

/** A memory ready to write to app_buyer_memories. */
interface MappedMemory {
  type: BuyerMemoryType;
  title: string;
  body: string;
  structured: Record<string, unknown>;
  tags: string[];
  external_id: string;
}

// ── RRG fetchers ──────────────────────────────────────────────────────

export async function fetchRrgAgent(rrgAgentId: string): Promise<RrgAgent | null> {
  const res = await fetch(`${RRG_BASE}/api/agent/${rrgAgentId}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { agent?: RrgAgent };
  return j.agent ?? null;
}

export async function fetchRrgMemories(rrgAgentId: string): Promise<RrgMemory[]> {
  const res = await fetch(`${RRG_BASE}/api/agent/${rrgAgentId}/memory`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { memories?: RrgMemory[] };
  return (j.memories ?? []).filter((m) => m.active !== false);
}

// ── Mapping ───────────────────────────────────────────────────────────

/** RRG memory type -> VIA buyer memory type. */
function mapType(t: RrgMemory['type']): BuyerMemoryType {
  switch (t) {
    case 'brand':        return 'brand_affinity';
    case 'size':         return 'constraint';
    case 'style':
    case 'preference':
    case 'consolidated': return 'preference';
    case 'general':
    default:             return 'general';
  }
}

function titleFrom(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 80 ? oneLine : `${oneLine.slice(0, 77)}...`;
}

/** Map a single RRG memory row. Returns null if it has no usable content. */
export function mapRrgMemory(m: RrgMemory): MappedMemory | null {
  const body = (m.content ?? '').trim();
  if (body.length < 3) return null;
  return {
    type: mapType(m.type),
    title: titleFrom(body),
    body: body.slice(0, 2000),
    structured: {},
    tags: [],
    external_id: m.id,
  };
}

/** Turn the RRG persona fields into stable memory rows (deterministic ids so a
 *  later sync updates them in place rather than duplicating). */
function personaMemories(agent: RrgAgent): MappedMemory[] {
  const out: MappedMemory[] = [];

  const instr = (agent.free_instructions ?? '').trim();
  if (instr.length >= 3) {
    out.push({
      type: 'preference',
      title: titleFrom(instr),
      body: instr.slice(0, 2000),
      structured: {},
      tags: ['rrg-persona'],
      external_id: 'persona:free_instructions',
    });
  }

  const ceiling = agent.budget_ceiling_usdc != null ? Number(agent.budget_ceiling_usdc) : NaN;
  if (Number.isFinite(ceiling) && ceiling > 0) {
    out.push({
      type: 'budget',
      title: `Budget ceiling ${ceiling} USDC`,
      body: `Standing budget ceiling of ${ceiling} USDC per purchase, carried over from the RRG concierge.`,
      structured: { max_usd: ceiling },
      tags: ['rrg-persona'],
      external_id: 'persona:budget',
    });
  }

  const tags = (agent.style_tags ?? []).filter((t) => typeof t === 'string' && t.trim());
  if (tags.length > 0) {
    out.push({
      type: 'preference',
      title: `Style: ${tags.join(', ')}`.slice(0, 80),
      body: `Style preferences carried over from the RRG concierge: ${tags.join(', ')}.`,
      structured: { style_tags: tags },
      tags: ['rrg-persona'],
      external_id: 'persona:style_tags',
    });
  }

  const bio = (agent.persona_bio ?? '').trim();
  if (bio.length >= 3) {
    out.push({
      type: 'general',
      title: titleFrom(bio),
      body: bio.slice(0, 2000),
      structured: {},
      tags: ['rrg-persona'],
      external_id: 'persona:bio',
    });
  }

  return out;
}

// ── Memory sync (insert new, update changed; never duplicate) ─────────

/**
 * Upsert the mapped persona + memories for a linked buyer. Idempotent by
 * (buyer_id, external_source, external_id): an unchanged memory is left alone,
 * a changed body is updated, a new one is inserted. Returns counts.
 */
async function upsertMemories(buyerId: string, mapped: MappedMemory[]): Promise<{ inserted: number; updated: number }> {
  if (mapped.length === 0) return { inserted: 0, updated: 0 };

  const { data: existingRows } = await db
    .from('app_buyer_memories')
    .select('id, external_id, body')
    .eq('buyer_id', buyerId)
    .eq('external_source', EXTERNAL_SOURCE);

  const existing = new Map<string, { id: string; body: string }>();
  for (const r of (existingRows ?? []) as Array<{ id: string; external_id: string; body: string }>) {
    if (r.external_id) existing.set(r.external_id, { id: r.id, body: r.body });
  }

  const toInsert: Array<Record<string, unknown>> = [];
  let updated = 0;

  for (const m of mapped) {
    const prior = existing.get(m.external_id);
    if (!prior) {
      toInsert.push({
        buyer_id:        buyerId,
        type:            m.type,
        title:           m.title,
        body:            m.body,
        structured:      m.structured,
        tags:            m.tags,
        active:          true,
        external_source: EXTERNAL_SOURCE,
        external_id:     m.external_id,
      });
    } else if (prior.body !== m.body) {
      const { error } = await db
        .from('app_buyer_memories')
        .update({ type: m.type, title: m.title, body: m.body, structured: m.structured, active: true })
        .eq('id', prior.id);
      if (!error) updated++;
    }
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await db.from('app_buyer_memories').insert(toInsert).select('id');
    if (error) throw new Error(`memory insert failed: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  return { inserted, updated };
}

/**
 * Pull RRG persona + memories for a linked buyer and upsert them. Reused by the
 * sync cron. Returns counts (or null if the RRG agent is unreachable).
 */
export async function syncConciergeMemories(
  buyerId: string,
  rrgAgentId: string,
): Promise<{ inserted: number; updated: number } | null> {
  const [agent, memories] = await Promise.all([
    fetchRrgAgent(rrgAgentId),
    fetchRrgMemories(rrgAgentId),
  ]);
  if (!agent) return null;

  const mapped = [
    ...personaMemories(agent),
    ...memories.map(mapRrgMemory).filter((m): m is MappedMemory => m !== null),
  ];
  return upsertMemories(buyerId, mapped);
}

// ── Handle allocation ─────────────────────────────────────────────────

async function allocateHandle(seed: string): Promise<string> {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'buyer';

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`.slice(0, 60);
    const { data } = await db.from('app_buyers').select('id').eq('handle', candidate).maybeSingle();
    if (!data) return candidate;
  }
  // Fall back to a suffix that is essentially certain to be free.
  return `${base}-${syntheticTestAgentId().slice(5, 11).toLowerCase()}`.slice(0, 60);
}

// ── Public import entry ───────────────────────────────────────────────

export interface ImportResult {
  ok: boolean;
  buyer?: { id: string; handle: string; display_name: string | null };
  alreadyLinked?: boolean;
  memories?: { inserted: number; updated: number };
  error?: string;
}

/**
 * Create (or re-link) a VIA buying agent from an RRG concierge.
 *
 * Idempotent on linked_rrg_agent_id: a second call for the same RRG agent
 * re-syncs memories onto the existing buyer rather than creating a duplicate.
 */
export async function importConcierge(opts: {
  rrgAgentId: string;
  walletAddress: string;
  displayName?: string;
  ownerUserId: string;
}): Promise<ImportResult> {
  const { rrgAgentId, ownerUserId } = opts;
  const funding = opts.walletAddress.trim().toLowerCase();

  // Already linked? Re-sync and return the existing buyer.
  const { data: priorLink } = await db
    .from('app_buyers')
    .select('id, handle, display_name')
    .eq('linked_rrg_agent_id', rrgAgentId)
    .maybeSingle();
  if (priorLink) {
    const memories = await syncConciergeMemories(priorLink.id as string, rrgAgentId).catch(() => null);
    return {
      ok: true,
      buyer: priorLink as ImportResult['buyer'],
      alreadyLinked: true,
      memories: memories ?? undefined,
    };
  }

  const skipMint = process.env.VIA_SKIP_ERC8004 === '1';
  if (!skipMint && !platformAgentWalletsEnabled()) {
    return { ok: false, error: 'platform-managed identity wallets are not enabled; contact VIA' };
  }

  // Pull the RRG persona up front so we have a name for the handle even if the
  // handoff payload omitted it.
  const agent = await fetchRrgAgent(rrgAgentId);
  if (!agent) return { ok: false, error: `RRG concierge ${rrgAgentId} not reachable` };

  const displayName = (opts.displayName ?? agent.name ?? 'Buying Agent').trim();
  const handle = await allocateHandle(displayName || rrgAgentId);

  const { data: buyer, error: buyerErr } = await db
    .from('app_buyers')
    .insert({
      handle,
      owner_user_id:        ownerUserId,
      display_name:         displayName,
      wallet_address:       funding,
      agent_wallet_address: null,
      linked_rrg_agent_id:  rrgAgentId,
      public:               false,
    })
    .select('id, handle, display_name')
    .single();

  if (buyerErr || !buyer) {
    if (buyerErr?.code === '23505') return { ok: false, error: 'handle taken (race), retry' };
    return { ok: false, error: `failed to create buyer record: ${buyerErr?.message ?? 'insert failed'}` };
  }

  // Mint the buyer's OWN platform-derived identity (never the RRG wallet). On a
  // failure, roll back so a retry works. Test mode writes a synthetic placeholder.
  if (skipMint) {
    const placeholder = syntheticTestAgentId();
    const derived = deriveAgentWallet(buyer.id as string);
    await db.from('app_buyers')
      .update({ erc8004_agent_id: placeholder, ...(derived ? { agent_wallet_address: derived.address.toLowerCase() } : {}) })
      .eq('id', buyer.id);
  } else {
    const mint = await mintBuyerIdentity(buyer.id as string, 'rrg_link');
    if (!mint.ok) {
      await db.from('app_buyers').delete().eq('id', buyer.id);
      return { ok: false, error: `could not mint buying-agent identity: ${mint.error ?? 'mint failed'}` };
    }
  }

  // Welcome credits (idempotent; RRG credits are a separate ledger, not transferred).
  try { await grantWelcomeCredits(buyer.id as string); }
  catch (err) { console.error(`[rrg-import] welcome-credit grant failed handle=${buyer.handle}:`, err); }

  // Seed persona + memories.
  let memories: { inserted: number; updated: number } | undefined;
  try {
    memories = (await syncConciergeMemories(buyer.id as string, rrgAgentId)) ?? undefined;
  } catch (err) {
    console.error(`[rrg-import] memory seed failed handle=${buyer.handle}:`, err);
  }

  return { ok: true, buyer: buyer as ImportResult['buyer'], memories };
}
