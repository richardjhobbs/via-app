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
        'Search the VIA network catalogue for drops matching criteria. ' +
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
        'List all brands currently on the VIA network with their slug, ' +
        'name, brand_url, and active drop count. ' +
        'CALL AT MOST ONCE PER CHAT SESSION. The brand list does not ' +
        'change mid-session, so after the first call the result is in ' +
        'your conversation context. Do NOT call it again. Only useful ' +
        'when you need to discover a brand slug you don\'t already know.',
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

async function via_search_drops(args: {
  query?: string;
  brand_slug?: string;
  max_price_usdc?: number;
  drop_type?: string;
  limit?: number;
}) {
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

  // Ranked search via the agent_search_drops Postgres function. ts_rank
  // orders by relevance (best match first); ties fall back to approved_at
  // desc. PL/pgSQL captures the tsquery as a local variable so the planner
  // uses the idx_rrg_submissions_search_tsv GIN index. ~10 ms regardless
  // of catalogue size.
  const { data, error } = await db.rpc('agent_search_drops', {
    q: args.query?.trim() || null,
    brand_id_filter: scopedBrandId,
    max_price: args.max_price_usdc ?? null,
    drop_type_filter: args.drop_type ?? null,
    suspended_ids: suspendedIds,
    result_limit: limit,
    network_filter: getCurrentNetwork(),
  });

  if (error) {
    return { error: `search failed: ${error.message}` };
  }

  const rows = (data ?? []) as unknown as DropRow[];
  return {
    network: 'via',
    backend: 'rrg',
    count: rows.length,
    drops: rows.map(r => summariseRow(r, brands)),
  };
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

  const listed = Array.from(counts.entries())
    .map(([brandId, drop_count]) => {
      const b = brands.get(brandId);
      if (!b) return null;
      return {
        brand_name: b.name,
        brand_slug: b.slug,
        brand_url: brandUrl(b.slug),
        drop_count,
      };
    })
    .filter((x): x is { brand_name: string; brand_slug: string; brand_url: string | null; drop_count: number } => x !== null)
    .sort((a, b) => b.drop_count - a.drop_count);

  return { network: 'via', backend: 'rrg', count: listed.length, brands: listed };
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

// ── Dispatcher ───────────────────────────────────────────────────────

export async function executeViaTool(
  name: string,
  argsJson: string,
  ctx: { agentId: string }
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (e) {
    return JSON.stringify({ error: `bad arguments JSON: ${(e as Error).message}` });
  }

  try {
    switch (name) {
      case 'via_search_drops': return JSON.stringify(await via_search_drops(args as Parameters<typeof via_search_drops>[0]));
      case 'via_get_drop':     return JSON.stringify(await via_get_drop(args as Parameters<typeof via_get_drop>[0]));
      case 'via_list_brands':  return JSON.stringify(await via_list_brands());
      case 'via_get_brand':    return JSON.stringify(await via_get_brand(args as Parameters<typeof via_get_brand>[0]));
      case 'via_recall_owner': return JSON.stringify(await via_recall_owner({}, ctx));
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
