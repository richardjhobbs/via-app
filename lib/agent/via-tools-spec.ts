/**
 * VIA-network tools available to agents during chat.
 *
 * The agent operates EXCLUSIVELY within the VIA network. Today the VIA
 * network = Real Real Genuine. Future partner platforms will be reachable
 * via the same `via_*` tools without changing the LLM contract — the
 * handlers fan out to additional backends server-side.
 *
 * OpenAI-compatible function-calling format. DeepSeek consumes this shape
 * directly. Anthropic Claude can consume the same {name, description,
 * parameters} via its tools API by remapping the wrapper.
 */
import { loadMemories } from './memory';

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
        'matching drops with title, brand, price (USDC), editions remaining, ' +
        'and the canonical drop URL. Always call this when the owner asks ' +
        'about products, drops, brands, or what is available — never invent ' +
        'inventory.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text search across drop title, description, and brand name. Lowercased substring match.',
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
        'List all brands currently on the VIA network with how many active drops ' +
        'each has. Use this to discover brand slugs before calling via_get_brand ' +
        'or via_search_drops.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'via_get_brand',
      description:
        'Get a brand\'s name and all their currently active drops by slug. ' +
        'Use when the owner mentions a brand by name — never speculate about a ' +
        'brand\'s catalogue.',
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
        'Recall what you have learned about your owner across past sessions — ' +
        'their brands, sizes, taste, budget sensitivity, etc. Call this whenever ' +
        'you need to ground a recommendation in their preferences.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────

interface Drop {
  token_id: number;
  title: string;
  description: string | null;
  enhanced_description: string | null;
  price_usdc: number;
  edition_size: number;
  brand_name: string | null;
  brand_slug: string | null;
  brand_id: string | null;
  drop_type: string | null;
  status: string;
  hidden: boolean;
  is_brand_product: boolean;
  jpeg_storage_path: string | null;
  ipfs_image_cid: string | null;
}

async function fetchAllDrops(): Promise<Drop[]> {
  const res = await fetch(`${SITE_URL}/api/rrg/drops`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`drops API ${res.status}`);
  const data = await res.json();
  const drops: Drop[] = (data.drops ?? []) as Drop[];
  return drops.filter(d => !d.hidden && d.status === 'approved');
}

function dropUrl(tokenId: number): string {
  return `${SITE_URL}/rrg/drop/${tokenId}`;
}

function summariseDrop(d: Drop) {
  return {
    token_id: d.token_id,
    title: d.title,
    brand_name: d.brand_name,
    brand_slug: d.brand_slug,
    price_usdc: d.price_usdc,
    edition_size: d.edition_size,
    drop_type: d.drop_type,
    is_physical: d.is_brand_product,
    description: d.description,
    url: dropUrl(d.token_id),
  };
}

function fullDrop(d: Drop) {
  return {
    ...summariseDrop(d),
    description: d.description,
    enhanced_description: d.enhanced_description,
  };
}

async function via_search_drops(args: {
  query?: string;
  brand_slug?: string;
  max_price_usdc?: number;
  drop_type?: string;
  limit?: number;
}) {
  let drops = await fetchAllDrops();
  if (args.brand_slug) {
    const slug = args.brand_slug.toLowerCase();
    drops = drops.filter(d => d.brand_slug?.toLowerCase() === slug);
  }
  if (args.max_price_usdc !== undefined) {
    drops = drops.filter(d => d.price_usdc <= args.max_price_usdc!);
  }
  if (args.drop_type && args.drop_type !== 'any') {
    drops = drops.filter(d => d.drop_type === args.drop_type);
  }
  if (args.query) {
    const q = args.query.toLowerCase();
    drops = drops.filter(d =>
      (d.title?.toLowerCase().includes(q) ?? false) ||
      (d.description?.toLowerCase().includes(q) ?? false) ||
      (d.enhanced_description?.toLowerCase().includes(q) ?? false) ||
      (d.brand_name?.toLowerCase().includes(q) ?? false) ||
      (d.brand_slug?.toLowerCase().includes(q) ?? false)
    );
  }
  const limit = Math.min(args.limit ?? 10, 20);
  const trimmed = drops.slice(0, limit);
  return {
    network: 'via',
    backend: 'rrg',
    count: trimmed.length,
    total_matches: drops.length,
    drops: trimmed.map(summariseDrop),
  };
}

async function via_get_drop(args: { token_id: number }) {
  const drops = await fetchAllDrops();
  const d = drops.find(x => x.token_id === args.token_id);
  if (!d) {
    return { found: false, message: `No drop with token_id ${args.token_id} on the VIA network.` };
  }
  return { found: true, drop: fullDrop(d) };
}

async function via_list_brands() {
  const drops = await fetchAllDrops();
  const counts = new Map<string, { brand_name: string; brand_slug: string; drop_count: number }>();
  for (const d of drops) {
    if (!d.brand_slug || !d.brand_name) continue;
    const existing = counts.get(d.brand_slug);
    if (existing) existing.drop_count++;
    else counts.set(d.brand_slug, { brand_name: d.brand_name, brand_slug: d.brand_slug, drop_count: 1 });
  }
  const brands = Array.from(counts.values()).sort((a, b) => b.drop_count - a.drop_count);
  return { network: 'via', backend: 'rrg', count: brands.length, brands };
}

async function via_get_brand(args: { slug: string }) {
  const slug = args.slug.toLowerCase();
  const drops = (await fetchAllDrops()).filter(d => d.brand_slug?.toLowerCase() === slug);
  if (drops.length === 0) {
    return { found: false, message: `No brand with slug "${slug}" on the VIA network. Call via_list_brands to see available slugs.` };
  }
  return {
    found: true,
    brand_slug: slug,
    brand_name: drops[0].brand_name,
    drop_count: drops.length,
    drops: drops.map(summariseDrop),
  };
}

async function via_recall_owner(args: {}, ctx: { agentId: string }) {
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
  let args: any;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (e) {
    return JSON.stringify({ error: `bad arguments JSON: ${(e as Error).message}` });
  }

  try {
    switch (name) {
      case 'via_search_drops': return JSON.stringify(await via_search_drops(args));
      case 'via_get_drop':     return JSON.stringify(await via_get_drop(args));
      case 'via_list_brands':  return JSON.stringify(await via_list_brands());
      case 'via_get_brand':    return JSON.stringify(await via_get_brand(args));
      case 'via_recall_owner': return JSON.stringify(await via_recall_owner(args, ctx));
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
