/**
 * VIA-network tools available to agents during chat.
 *
 * The agent operates EXCLUSIVELY within the VIA network. Today the VIA
 * network = Real Real Genuine. Future partner platforms will be reachable
 * via the same `via_*` tools without changing the LLM contract. The
 * handlers fan out to additional backends server-side.
 *
 * OpenAI-compatible function-calling format. DeepSeek consumes this shape
 * directly. Anthropic Claude can consume the same {name, description,
 * parameters} via its tools API by remapping the wrapper.
 *
 * Search path. The catalogue has ~6,000 approved drops and growing. The
 * search tools hit the GIN-indexed `search_tsv` column on rrg_submissions
 * via Supabase's textSearch (websearch_to_tsquery). One indexed query is
 * sub-200 ms regardless of catalogue size. Earlier revisions of this file
 * scanned the full catalogue in JS, which took 10+ s and was the root
 * cause of the agent's tool timeouts.
 */
import { loadMemories } from './memory';
import {
  db,
  getCurrentNetwork,
  getNonActiveBrandIds,
  getAllActiveBrands,
} from '@/lib/rrg/db';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

// ── Schemas ──────────────────────────────────────────────────────────

export const VIA_TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'via_search_drops',
      description:
        'Semantically search the VIA network catalogue. The query is ' +
        'embedded and matched against product embeddings (text-embedding-3-small ' +
        'cosine). This means "any coffee?" finds Nolo (decaf cold-brew) even ' +
        'though no Nolo product title contains "coffee"; "warm for winter" ' +
        'finds heavy knits, coats, wool pieces by INTENT, not literal text. ' +
        'Use natural intent phrases, not just keywords: "anything boho" beats ' +
        '"boho", "something for a wedding" beats "formal". ' +
        'Today the VIA network = Real Real Genuine (RRG). Returns up to 20 ' +
        'matching drops as compact summaries (title, brand, price USDC, ' +
        'editions remaining, `url`, `brand_url`). Descriptions are NOT ' +
        'included. Call via_get_drop for one drop if you need full detail. ' +
        'Use this as your PRIMARY discovery tool: one well-scoped search ' +
        'almost always beats multiple via_get_brand calls. Never invent ' +
        'inventory. For generic queries link `brand_url`; for specific ' +
        'product queries link `url`.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text search across drop title, description, enhanced description, and brand name. Runs as a Postgres websearch_to_tsquery against the search_tsv index, so multi-word phrases and minus-prefixes both work.',
          },
          brand_slug: {
            type: 'string',
            description: 'Filter to a single brand by slug (e.g. "frey-tailored", "clooudie"). Use via_list_brands first if you do not know the slug.',
          },
          max_price_usdc: {
            type: 'number',
            description: 'Cap drops at this USDC price. Useful for budget-aware recommendations.',
          },
          drop_type: {
            type: 'string',
            enum: ['co_created', 'brand_product', 'any'],
            description: 'Filter by drop kind. Default: any.',
          },
          audience: {
            type: 'string',
            enum: ['men', 'women', 'unisex', 'any'],
            description: 'Audience scope. By default this is filled in from the owner\'s profile (e.g. a male owner sees men + unisex). Set explicitly only when the owner is shopping for someone else, e.g. "find a gift for my partner"; pass "any" to override the default scope and search the whole catalogue.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Max drops to return (default 10).',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'via_get_drop',
      description:
        'Get full detail for one drop by token_id. Returns enhanced description, ' +
        'price, editions remaining, image URL, and the canonical RRG link the ' +
        'owner can click to view or buy.',
      parameters: {
        type: 'object',
        properties: {
          token_id: { type: 'integer' },
        },
        required: ['token_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'via_list_brands',
      description:
        'List all brands currently on the VIA network. Each brand returns ' +
        'slug, name, brand_url, active drop_count, plus a sample_title and ' +
        'sample_snippet drawn from one representative product. The samples ' +
        'let you SEMANTICALLY infer brand category when the brand name ' +
        'alone is opaque (e.g. "Nolo" + "Caramel Swirl is Nolo\'s flavoured ' +
        'decaf cold-brewed Arabica" => Nolo is a decaf coffee brand). ' +
        'CALL AT MOST ONCE PER CHAT SESSION. The brand list does not ' +
        'change mid-session, so after the first call the result is in ' +
        'your conversation context. Do NOT call it again. ' +
        'Use this as your PRIMARY discovery tool for category questions ' +
        '("any food?", "any coffee?", "anything from Japan?", "any ' +
        'baseball caps?") because text search on the user\'s word will ' +
        'miss brands whose product titles don\'t literally contain it.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'via_get_brand',
      description:
        'Get a brand\'s name and all their currently active drops by slug ' +
        '(compact summaries, no descriptions; call via_get_drop for one ' +
        'drop if needed). Use ONLY when the owner explicitly names a brand. ' +
        'For "show me X" queries prefer via_search_drops with a query ' +
        'string instead, since it\'s one round-trip vs many.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Brand slug, e.g. "toshi" or "frey-tailored".' },
        },
        required: ['slug'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'via_recall_owner',
      description:
        'Recall what you have learned about your owner across past sessions: ' +
        'their brands, sizes, taste, budget sensitivity, etc. Call this whenever ' +
        'you need to ground a recommendation in their preferences.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'via_notify_owner',
      description:
        'Leave an asynchronous notification for the owner in their dashboard. ' +
        'Use this when the owner asks you to message or alert them later (e.g. ' +
        '"let me know if something similar comes along", "ping me when X drops", ' +
        '"follow up tomorrow"). The notification appears on their dashboard with ' +
        'an unread flag. Do NOT use it to reply inside the current chat turn, ' +
        'and do NOT use it for routine acknowledgements. Always include a clear ' +
        'title and a body that explains exactly what is being watched, so the ' +
        'owner can understand it days later without rereading the chat.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short headline, under 80 chars. Example: "Watching for new Soulland drops".',
          },
          body: {
            type: 'string',
            description: 'One or two sentences describing the watch, the trigger, and what the owner will see when it fires.',
          },
          watch_terms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of brand slugs, style keywords, or product terms the watch is tied to. Persisted alongside the notification so future searches can dedupe.',
          },
        },
        required: ['title', 'body'],
      },
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────

interface DropRow {
  token_id: number;
  title: string;
  description?: string | null;
  enhanced_description?: string | null;
  price_usdc: number;
  edition_size: number;
  brand_id: string | null;
  drop_type: string | null;
  is_brand_product: boolean;
  jpeg_storage_path: string | null;
  ipfs_image_cid: string | null;
  approved_at: string | null;
  rank?: number;
  match_type?: 'exact' | 'fuzzy';
}

// Columns the summary path needs. Critically does NOT include the heavy
// description columns; via_get_drop fetches those for one drop only.
const SUMMARY_COLUMNS = [
  'token_id',
  'title',
  'price_usdc',
  'edition_size',
  'brand_id',
  'drop_type',
  'is_brand_product',
  'jpeg_storage_path',
  'ipfs_image_cid',
  'approved_at',
].join(',');

const FULL_COLUMNS = [SUMMARY_COLUMNS, 'description', 'enhanced_description'].join(',');

function dropUrl(tokenId: number): string {
  return `${SITE_URL}/rrg/drop/${tokenId}`;
}

function brandUrl(slug: string | null): string | null {
  return slug ? `${SITE_URL}/brand/${slug}` : null;
}

// Process-level brand lookup. getAllActiveBrands() is already wrapped in
// unstable_cache by lib/rrg/db, so this just keeps a Promise to share across
// concurrent tool calls in one request.
async function brandLookup(): Promise<Map<string, { name: string; slug: string }>> {
  const brands = await getAllActiveBrands();
  return new Map(brands.map(b => [b.id, { name: b.name, slug: b.slug }]));
}

function summariseRow(row: DropRow, brands: Map<string, { name: string; slug: string }>) {
  const brand = row.brand_id ? brands.get(row.brand_id) : null;
  return {
    token_id: row.token_id,
    title: row.title,
    brand_name: brand?.name ?? null,
    brand_slug: brand?.slug ?? null,
    price_usdc: row.price_usdc,
    edition_size: row.edition_size,
    drop_type: row.drop_type,
    is_physical: row.is_brand_product,
    url: dropUrl(row.token_id),
    brand_url: brandUrl(brand?.slug ?? null),
    // Match quality from agent_search_drops. 'fuzzy' means the row was
    // recovered via trigram word_similarity because the FTS query had a
    // typo. The agent should phrase fuzzy results as "I think you meant".
    match_type: row.match_type ?? 'exact',
  };
}

function fullRow(row: DropRow, brands: Map<string, { name: string; slug: string }>) {
  return {
    ...summariseRow(row, brands),
    description: row.description ?? null,
    enhanced_description: row.enhanced_description ?? null,
  };
}

/**
 * Build the common scope for any agent drop query: status=approved,
 * current network, not hidden, not on a suspended brand. Callers chain
 * further filters and the final select/limit.
 */
function baseDropsQuery(columns: string, suspendedIds: string[]) {
  let q = db
    .from('rrg_submissions')
    .select(columns)
    .eq('status', 'approved')
    .eq('network', getCurrentNetwork())
    .eq('hidden', false);
  if (suspendedIds.length > 0) {
    q = q.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
  }
  return q;
}

async function via_search_drops(
  args: {
    query?: string;
    brand_slug?: string;
    max_price_usdc?: number;
    drop_type?: string;
    audience?: 'men' | 'women' | 'unisex' | 'any';
    limit?: number;
  },
  ctx: { agentId: string; ownerSex: 'male' | 'female' | 'other' | null }
) {
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);
  const [suspendedIds, brands] = await Promise.all([
    getNonActiveBrandIds(),
    brandLookup(),
  ]);

  // Resolve brand_slug -> brand_id up front, since rrg_submissions only
  // stores brand_id. An unknown slug yields zero matches (no need to query).
  let scopedBrandId: string | null = null;
  if (args.brand_slug) {
    const slug = args.brand_slug.toLowerCase();
    const entry = Array.from(brands.entries()).find(([, b]) => b.slug.toLowerCase() === slug);
    if (!entry) {
      return {
        network: 'via',
        backend: 'rrg',
        count: 0,
        drops: [],
        note: `No brand with slug "${slug}" is active on the VIA network. Call via_list_brands to see available slugs.`,
      };
    }
    scopedBrandId = entry[0];
  }

  // Audience filter resolution. The LLM can override the default by
  // passing args.audience. 'any' means "search the whole catalogue
  // even if I have a sex on file". Otherwise default to the owner's
  // sex mapped to the catalogue's audience vocabulary.
  let audienceFilter: 'men' | 'women' | null = null;
  if (args.audience === 'men' || args.audience === 'women' || args.audience === 'unisex') {
    // Unisex is the same as "no filter" at the function level (unisex
    // rows surface to anyone), but treat as null for clarity.
    audienceFilter = args.audience === 'unisex' ? null : args.audience;
  } else if (args.audience === 'any') {
    audienceFilter = null;
  } else if (ctx.ownerSex === 'male') {
    audienceFilter = 'men';
  } else if (ctx.ownerSex === 'female') {
    audienceFilter = 'women';
  }

  const rawQuery = args.query?.trim() ?? '';
  const network = getCurrentNetwork();

  // ── Semantic path (PRIMARY) ────────────────────────────────────────
  // Per the agentic-commerce vision, intent-driven retrieval is the
  // default. Embed the query, cosine-search the product space, surface
  // results regardless of whether the literal word appears in titles
  // or descriptions. "Any coffee?" finds Nolo even though no Nolo
  // product title contains "coffee".
  //
  // Falls back to tsvector + trigram only if:
  //   - no query (filters-only browse)
  //   - OPENAI_API_KEY missing
  //   - embedding call fails
  //   - semantic search returns 0 hits (typo tolerance)
  //
  // Cost: ~25 tokens per query × $0.02/M = $0.0000005, billed to the
  // agent via deductCredits below.
  if (rawQuery.length > 0 && process.env.OPENAI_API_KEY) {
    try {
      const { embedText, toPgVectorLiteral } = await import('./embeddings');
      const { deductCredits } = await import('./credits');

      const embedded = await embedText(rawQuery);

      // Best-effort billing. A failed deduct must NOT block the search;
      // the query still happens and the user gets an answer.
      try {
        await deductCredits(ctx.agentId, embedded.tokensUsed, 'deepseek');
      } catch (billErr) {
        console.error('[via_search_drops embed bill]', billErr);
      }

      const { data: semData, error: semErr } = await db.rpc('agent_semantic_search', {
        query_embedding: toPgVectorLiteral(embedded.vector),
        brand_id_filter: scopedBrandId,
        max_price: args.max_price_usdc ?? null,
        drop_type_filter: args.drop_type ?? null,
        suspended_ids: suspendedIds,
        result_limit: limit,
        network_filter: network,
        audience_filter: audienceFilter,
        min_similarity: 0.15,
      });

      if (!semErr && semData && (semData as unknown as DropRow[]).length > 0) {
        const rows = semData as unknown as DropRow[];
        const summarised = rows.map(r => summariseRow(r, brands));
        return {
          network: 'via',
          backend: 'rrg',
          count: rows.length,
          match: 'semantic' as const,
          drops: summarised,
        };
      }
      // Fall through to lexical path if semantic returned 0 or errored.
      if (semErr) console.error('[agent_semantic_search]', semErr);
    } catch (err) {
      console.error('[via_search_drops semantic]', err);
      // Fall through to lexical path.
    }
  }

  // ── Lexical path (FALLBACK / no-query browse) ──────────────────────
  // Ranked search via the agent_search_drops Postgres function. ts_rank
  // orders by relevance (best match first); ties fall back to approved_at
  // desc. PL/pgSQL captures the tsquery as a local variable so the planner
  // uses the idx_rrg_submissions_search_tsv GIN index.
  const { data, error } = await db.rpc('agent_search_drops', {
    q: rawQuery || null,
    brand_id_filter: scopedBrandId,
    max_price: args.max_price_usdc ?? null,
    drop_type_filter: args.drop_type ?? null,
    suspended_ids: suspendedIds,
    result_limit: limit,
    network_filter: network,
    audience_filter: audienceFilter,
  });

  if (error) {
    return { error: `search failed: ${error.message}` };
  }

  const rows = (data ?? []) as unknown as DropRow[];
  const summarised = rows.map(r => summariseRow(r, brands));
  const fuzzyCount = summarised.filter(d => d.match_type === 'fuzzy').length;
  const matchMode: 'exact' | 'fuzzy' | 'mixed' =
    fuzzyCount === 0 ? 'exact' :
    fuzzyCount === summarised.length ? 'fuzzy' : 'mixed';

  const result: {
    network: string;
    backend: string;
    count: number;
    match: typeof matchMode;
    drops: typeof summarised;
    note?: string;
  } = {
    network: 'via',
    backend: 'rrg',
    count: rows.length,
    match: matchMode,
    drops: summarised,
  };

  if (matchMode !== 'exact' && rawQuery) {
    result.note =
      `No semantic or exact text match for "${rawQuery}". The drops below are typo-tolerant recovery via trigram similarity. Confirm with the owner that this is what they meant before recommending.`;
  }

  return result;
}

async function via_get_drop(args: { token_id: number }) {
  if (typeof args.token_id !== 'number' || !Number.isFinite(args.token_id)) {
    return { found: false, message: 'token_id must be a number.' };
  }
  const [suspendedIds, brands] = await Promise.all([
    getNonActiveBrandIds(),
    brandLookup(),
  ]);
  const { data, error } = await baseDropsQuery(FULL_COLUMNS, suspendedIds)
    .eq('token_id', args.token_id)
    .maybeSingle();

  if (error) {
    return { found: false, message: `lookup failed: ${error.message}` };
  }
  if (!data) {
    return { found: false, message: `No drop with token_id ${args.token_id} on the VIA network.` };
  }
  return { found: true, drop: fullRow(data as unknown as DropRow, brands) };
}

async function via_list_brands() {
  const [suspendedIds, brands] = await Promise.all([
    getNonActiveBrandIds(),
    brandLookup(),
  ]);

  // Get per-brand active drop counts in one round-trip. Returns just the
  // brand_id column; we count in memory. At ~6k rows this is a few hundred KB.
  const { data, error } = await baseDropsQuery('brand_id', suspendedIds);
  if (error) {
    return { error: `lookup failed: ${error.message}`, brands: [] };
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as { brand_id: string | null }[]) {
    if (!row.brand_id) continue;
    counts.set(row.brand_id, (counts.get(row.brand_id) ?? 0) + 1);
  }

  // Per-brand semantic hint: a sample non-membership product title plus the
  // first chunk of its description. Lets the LLM infer category from
  // products (e.g. "Caramel Swirl ... cold-brewed decaf" => coffee brand)
  // when the brand name alone is opaque ("Nolo", "Clooudie"). One LATERAL
  // query, ~10 ms total, ~250 bytes per brand on the wire.
  const brandIds = Array.from(counts.keys());
  const sampleByBrand = new Map<string, { title: string; snippet: string }>();
  if (brandIds.length > 0) {
    const { data: samples } = await db.rpc('agent_brand_samples', {
      brand_ids: brandIds,
    });
    for (const row of (samples ?? []) as unknown as Array<{
      brand_id: string; sample_title: string | null; sample_snippet: string | null;
    }>) {
      if (!row.brand_id) continue;
      sampleByBrand.set(row.brand_id, {
        title: row.sample_title ?? '',
        snippet: (row.sample_snippet ?? '').slice(0, 220),
      });
    }
  }

  const listed = Array.from(counts.entries())
    .map(([brandId, drop_count]) => {
      const b = brands.get(brandId);
      if (!b) return null;
      const sample = sampleByBrand.get(brandId);
      return {
        brand_name: b.name,
        brand_slug: b.slug,
        brand_url: brandUrl(b.slug),
        drop_count,
        sample_title: sample?.title || null,
        sample_snippet: sample?.snippet || null,
      };
    })
    .filter((x): x is { brand_name: string; brand_slug: string; brand_url: string | null; drop_count: number; sample_title: string | null; sample_snippet: string | null } => x !== null)
    .sort((a, b) => b.drop_count - a.drop_count);

  return {
    network: 'via',
    backend: 'rrg',
    count: listed.length,
    brands: listed,
    note:
      'sample_title and sample_snippet are a representative non-membership product ' +
      'per brand. Use them to infer brand category when the name alone is opaque ' +
      '(e.g. "Nolo" => decaf coffee from "Caramel Swirl ... cold-brewed decaf").',
  };
}

async function via_get_brand(args: { slug: string }) {
  const slug = (args.slug ?? '').toLowerCase();
  if (!slug) return { found: false, message: 'slug is required.' };

  const [suspendedIds, brands] = await Promise.all([
    getNonActiveBrandIds(),
    brandLookup(),
  ]);

  const entry = Array.from(brands.entries()).find(([, b]) => b.slug.toLowerCase() === slug);
  if (!entry) {
    return { found: false, message: `No brand with slug "${slug}" on the VIA network. Call via_list_brands to see available slugs.` };
  }
  const [brandId, brand] = entry;

  const { data, error } = await baseDropsQuery(SUMMARY_COLUMNS, suspendedIds)
    .eq('brand_id', brandId)
    .order('approved_at', { ascending: false })
    .limit(20);

  if (error) {
    return { found: false, message: `lookup failed: ${error.message}` };
  }
  const rows = (data ?? []) as unknown as DropRow[];

  return {
    found: true,
    brand_slug: brand.slug,
    brand_name: brand.name,
    brand_url: brandUrl(brand.slug),
    drop_count: rows.length,
    drops: rows.map(r => summariseRow(r, brands)),
  };
}

async function via_recall_owner(_args: Record<string, never>, ctx: { agentId: string }) {
  const memories = await loadMemories(ctx.agentId, 30);
  return {
    fact_count: memories.length,
    memories: memories.map(m => ({
      type: m.type,
      content: m.content,
      created_at: m.created_at,
    })),
  };
}

async function via_notify_owner(
  args: { title?: string; body?: string; watch_terms?: string[] },
  ctx: { agentId: string; sessionId: string | null },
) {
  const title = (args.title ?? '').trim();
  const body = (args.body ?? '').trim();
  if (!title || !body) {
    return { ok: false, error: 'title and body are required.' };
  }
  if (title.length > 200) {
    return { ok: false, error: 'title too long (200 char max).' };
  }

  const watchTerms = Array.isArray(args.watch_terms)
    ? args.watch_terms.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 12)
    : [];

  const { data, error } = await db
    .from('agent_notifications')
    .insert({
      agent_id: ctx.agentId,
      kind: 'chat_followup',
      title: title.slice(0, 200),
      body: body.slice(0, 2000),
      payload: {
        session_id: ctx.sessionId,
        watch_terms: watchTerms,
        source: 'concierge_tool',
      },
    })
    .select('id, created_at')
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    notification_id: data?.id ?? null,
    created_at: data?.created_at ?? null,
    note: 'Notification queued. The owner will see it on their dashboard with an unread flag.',
  };
}

// ── Dispatcher ───────────────────────────────────────────────────────

export interface ToolCtx {
  agentId: string;
  ownerSex: 'male' | 'female' | 'other' | null;
  sessionId?: string | null;
}

export async function executeViaTool(
  name: string,
  argsJson: string,
  ctx: ToolCtx
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (e) {
    return JSON.stringify({ error: `bad arguments JSON: ${(e as Error).message}` });
  }

  try {
    switch (name) {
      case 'via_search_drops': return JSON.stringify(await via_search_drops(args as Parameters<typeof via_search_drops>[0], ctx));
      case 'via_get_drop':     return JSON.stringify(await via_get_drop(args as Parameters<typeof via_get_drop>[0]));
      case 'via_list_brands':  return JSON.stringify(await via_list_brands());
      case 'via_get_brand':    return JSON.stringify(await via_get_brand(args as Parameters<typeof via_get_brand>[0]));
      case 'via_recall_owner': return JSON.stringify(await via_recall_owner({}, ctx));
      case 'via_notify_owner': return JSON.stringify(await via_notify_owner(
        args as Parameters<typeof via_notify_owner>[0],
        { agentId: ctx.agentId, sessionId: ctx.sessionId ?? null },
      ));
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
