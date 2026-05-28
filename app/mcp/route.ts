/**
 * Central VIA app MCP endpoint — app.getvia.xyz/mcp
 *
 * Agents landing on the app's natural MCP URL discover sellers + routing
 * to per-seller endpoints here. Mirrors the discovery tools shipped on
 * the marketing-site MCP (www.getvia.xyz/mcp) but reads directly from
 * app_sellers (this app has the live data; the marketing site queries
 * the same Supabase project but is rebuilt less often).
 *
 * Tools (4):
 *   list_sellers      — active VIA sellers, paginated, with per-seller MCP URL
 *   find_seller       — ilike search over name + description + headline
 *   seller_mcp_url    — return + verify the per-seller MCP URL for a slug
 *   get_via_overview  — short pitch + entrypoint URLs for buyers / sellers
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

interface SellerSummaryRow {
  slug:             string;
  name:             string;
  kind:             string;
  headline:         string | null;
  description:      string | null;
  website_url:      string | null;
  erc8004_agent_id: string | null;
}

function sellerMcpUrl(slug: string): string {
  return `${APP_BASE}/sellers/${encodeURIComponent(slug)}/mcp`;
}

function rowToSummary(row: SellerSummaryRow) {
  return {
    slug:             row.slug,
    name:             row.name,
    kind:             row.kind,
    headline:         row.headline,
    description:      row.description,
    website_url:      row.website_url,
    erc8004_agent_id: row.erc8004_agent_id,
    mcp_url:          sellerMcpUrl(row.slug),
  };
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function createServer() {
  const server = new McpServer({ name: 'via-app-discovery', version: '1.0.0' });

  server.tool(
    'list_sellers',
    'List active VIA sellers (any product or service). Each result includes the per-seller MCP URL to connect to for deeper interaction (list_products, ask_sales_agent, buy_product).',
    {
      category: z.enum(['product', 'service', 'mixed']).optional().describe('Optional kind filter.'),
      limit:    z.number().int().min(1).max(100).optional().describe('Max sellers to return (default 25).'),
    },
    async ({ category, limit }) => {
      const max = Math.min(Math.max(limit ?? 25, 1), 100);
      let query = db
        .from('app_sellers')
        .select('slug, name, kind, headline, description, website_url, erc8004_agent_id')
        .eq('active', true)
        .order('name', { ascending: true })
        .limit(max);
      if (category) query = query.eq('kind', category);
      const { data, error } = await query;
      if (error) return asJson({ sellers: [], count: 0, note: `Seller index unavailable: ${error.message}` });
      const rows = (data ?? []) as SellerSummaryRow[];
      return asJson({ count: rows.length, sellers: rows.map(rowToSummary) });
    },
  );

  server.tool(
    'find_seller',
    'Search active VIA sellers by free-text query against name, description, and headline.',
    {
      query: z.string().min(1).describe("Free-text search, e.g. 'pendant lighting' or 'paralegal services for startups'."),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10).'),
    },
    async ({ query, limit }) => {
      const max = Math.min(Math.max(limit ?? 10, 1), 50);
      const safe = query.replace(/[%,()]/g, ' ').trim();
      const pattern = `%${safe}%`;
      const { data, error } = await db
        .from('app_sellers')
        .select('slug, name, kind, headline, description, website_url, erc8004_agent_id')
        .eq('active', true)
        .or(`name.ilike.${pattern},description.ilike.${pattern},headline.ilike.${pattern}`)
        .order('name', { ascending: true })
        .limit(max);
      if (error) return asJson({ query, sellers: [], count: 0, note: `Seller search unavailable: ${error.message}` });
      const rows = (data ?? []) as SellerSummaryRow[];
      return asJson({ query, count: rows.length, sellers: rows.map(rowToSummary) });
    },
  );

  server.tool(
    'seller_mcp_url',
    'Return the per-seller MCP endpoint URL for a given seller slug, verified against the active seller index.',
    {
      slug: z.string().min(1).describe("Seller slug (e.g. 'arc-lights')."),
    },
    async ({ slug }) => {
      const url = sellerMcpUrl(slug);
      const { data, error } = await db
        .from('app_sellers')
        .select('slug, name, active')
        .eq('slug', slug)
        .maybeSingle();
      if (error || !data) return asJson({ slug, mcp_url: url, verified: false, note: error?.message ?? 'Slug not found.' });
      if (!data.active)   return asJson({ slug, mcp_url: url, verified: false, note: 'Seller exists but is inactive.' });
      return asJson({ slug, name: data.name, mcp_url: url, verified: true });
    },
  );

  server.tool(
    'get_via_overview',
    'Short overview of VIA Labs, the agentic-commerce platform: what it does, key entrypoints for buyers and sellers, where to onboard.',
    {},
    async () => asJson({
      project:         'VIA Labs',
      one_liner:       'Agentic commerce settled in USDC on Base. Any seller exposes a Sales Agent over MCP; any buyer trains a Buying Agent that negotiates and pays on their behalf.',
      app_base:        APP_BASE,
      mcp_endpoint:    `${APP_BASE}/mcp`,
      onboard_seller:  `${APP_BASE}/onboard?role=seller`,
      onboard_buyer:   `${APP_BASE}/onboard?role=buyer`,
      per_seller_mcp:  `${APP_BASE}/sellers/{slug}/mcp`,
      marketing_site:  'https://www.getvia.xyz',
      central_mcp:     'https://www.getvia.xyz/mcp',
      tools_here: {
        list_sellers:    'Browse active sellers',
        find_seller:     'Free-text search',
        seller_mcp_url:  'Resolve a slug to its per-seller MCP URL',
      },
    }),
  );

  return server;
}

export async function GET() {
  return Response.json({
    name:        'via-app-discovery',
    version:     '1.0.0',
    description: 'VIA Labs central discovery MCP. POST JSON-RPC to this endpoint to call tools.',
    protocol:    'MCP Streamable HTTP',
    base:        APP_BASE,
    tools:       ['list_sellers', 'find_seller', 'seller_mcp_url', 'get_via_overview'],
  });
}

export async function POST(req: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, x-via-agent-id',
    },
  });
}
