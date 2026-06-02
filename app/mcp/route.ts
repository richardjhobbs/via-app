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
import { createPendingAgentStore } from '@/lib/app/store-registration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

// ── register_store rate limiting (best-effort, per warm instance) ────
// register_store creates a Supabase auth user + a DB row on every call, so it
// is the one write surface on this otherwise read-only discovery MCP. Throttle
// it hard, keyed by client IP over a sliding 5-minute window. Per-lambda-
// instance like the per-seller MCP limiter, which is enough to blunt scripted
// signup floods; a human approves every store before it goes live regardless.
const REGISTER_WINDOW_MS = 5 * 60_000;
const REGISTER_MAX = 5;
const registerHits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'noip';
}

function isRegisterRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (registerHits.get(ip) ?? []).filter((t) => now - t < REGISTER_WINDOW_MS);
  hits.push(now);
  registerHits.set(ip, hits);
  return hits.length > REGISTER_MAX;
}

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

// VIA network members federated over HTTP. Each exposes GET /api/via/search?q=&limit=
// returning { platform, results:[{name,kind,detail,mcp_url,web_url}] }. The catalogue
// and the buy stay at origin; the network layer only routes. Append future platforms here.
const NETWORK_MEMBERS: { platform: string; searchUrl: string }[] = [
  { platform: 'rrg', searchUrl: 'https://realrealgenuine.com/api/via/search' },
];

interface NetworkResult {
  platform:    string;
  name:        string;
  kind:        string;
  detail:      string | null;
  mcp_url:     string;
  web_url:     string | null;
}

async function fetchMember(member: { platform: string; searchUrl: string }, q: string, max: number): Promise<NetworkResult[]> {
  try {
    const url = `${member.searchUrl}?q=${encodeURIComponent(q)}&limit=${max}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const json = await res.json() as { platform?: string; results?: unknown };
    const rows = Array.isArray(json.results) ? json.results : [];
    return rows.map((r: any) => ({
      platform: json.platform ?? member.platform,
      name:     String(r?.name ?? ''),
      kind:     String(r?.kind ?? 'brand'),
      detail:   r?.detail ?? null,
      mcp_url:  String(r?.mcp_url ?? ''),
      web_url:  r?.web_url ?? null,
    })).filter((r) => r.name && r.mcp_url);
  } catch {
    return [];
  }
}

async function fetchNetwork(q: string, max: number): Promise<NetworkResult[]> {
  const batches = await Promise.all(NETWORK_MEMBERS.map((m) => fetchMember(m, q, max)));
  return batches.flat();
}

function rowToSummary(row: SellerSummaryRow): NetworkResult & { slug: string; erc8004_agent_id: string | null } {
  return {
    platform:         'via',
    slug:             row.slug,
    name:             row.name,
    kind:             row.kind,
    detail:           row.headline ?? row.description,
    erc8004_agent_id: row.erc8004_agent_id,
    web_url:          row.website_url,
    mcp_url:          sellerMcpUrl(row.slug),
  };
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function createServer(req: Request) {
  const server = new McpServer({ name: 'via-app-discovery', version: '1.0.0' });

  server.tool(
    'list_sellers',
    'List active sellers across the VIA network (VIA app + RRG + integrated platforms). Each result is tagged with its platform and includes the per-seller MCP URL to connect to for deeper interaction (list_products, ask_sales_agent, buy_product).',
    {
      category: z.enum(['product', 'service', 'mixed']).optional().describe('Optional kind filter (applies to VIA-app sellers only).'),
      limit:    z.number().int().min(1).max(100).optional().describe('Max sellers to return per platform (default 25).'),
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
      const [{ data, error }, network] = await Promise.all([
        query,
        fetchNetwork('', max),
      ]);
      if (error) console.error('[mcp/list_sellers] query failed:', error);
      const rows = (data ?? []) as SellerSummaryRow[];
      const sellers = [...rows.map(rowToSummary), ...network];
      return asJson({ count: sellers.length, sellers });
    },
  );

  server.tool(
    'find_seller',
    'Search active sellers across the VIA network (VIA app + RRG + integrated platforms) by free-text query. Results are tagged with their platform; connect to each result\'s mcp_url for the catalogue and the buy.',
    {
      query: z.string().min(1).describe("Free-text search, e.g. 'coffee', 'pendant lighting', or 'paralegal services for startups'."),
      limit: z.number().int().min(1).max(50).optional().describe('Max results per platform (default 10).'),
    },
    async ({ query, limit }) => {
      const max = Math.min(Math.max(limit ?? 10, 1), 50);
      const safe = query.replace(/[%,()]/g, ' ').trim();
      const pattern = `%${safe}%`;
      const [{ data, error }, network] = await Promise.all([
        db
          .from('app_sellers')
          .select('slug, name, kind, headline, description, website_url, erc8004_agent_id')
          .eq('active', true)
          .or(`name.ilike.${pattern},description.ilike.${pattern},headline.ilike.${pattern}`)
          .order('name', { ascending: true })
          .limit(max),
        fetchNetwork(safe, max),
      ]);
      if (error) console.error('[mcp/find_seller] query failed:', error);
      const rows = (data ?? []) as SellerSummaryRow[];
      const sellers = [...rows.map(rowToSummary), ...network];
      return asJson({ query, count: sellers.length, sellers });
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
      if (error) {
        console.error('[mcp/seller_mcp_url] query failed:', error);
        return asJson({ slug, mcp_url: url, verified: false, error_code: 'verification_unavailable', note: 'Could not verify the slug right now. Please retry.' });
      }
      if (!data) return asJson({ slug, mcp_url: url, verified: false, note: 'Slug not found.' });
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
      network:         'list_sellers and find_seller federate across every VIA network member (VIA app + RRG + integrated platforms). Results are tagged by platform; connect to each result mcp_url for the catalogue and the buy.',
      agent_self_onboard: {
        summary:    'Agents can register their own store over this MCP with two of their own wallets, no thirdweb, no human wizard. The VIA network keeps a flat 2.5% fee on each sale; you keep 97.5% to your payout wallet. Your store gets its own ERC-8004 identity on approval.',
        how: [
          '1. Call register_store with: store_name, kind (product|service|mixed), a payout_wallet (your USDC EOA) and a DIFFERENT agent_wallet (your ERC-8004 identity EOA), plus a contact email + password you keep for the dashboard.',
          '2. Your store is created PENDING and stays invisible (not in list_sellers / find_seller, no per-seller MCP) until a human reviews it. Review happens within 24 hours.',
          '3. Poll get_store_status with your slug. On "approved" the store is live, the ERC-8004 agent id is minted to your agent_wallet, and your per-seller MCP url is returned.',
          '4. Manage your catalogue agent-to-agent: POST your email + password to /api/sellers/{slug}/agent/auth to receive a store key, then call the management MCP at /sellers/{slug}/manage/mcp (x-via-store-key header) to create_product, list_my_products, and publish_product. The dashboard at dashboard_url is the human alternative.',
        ],
        manage_after_approval: {
          obtain_key:    `${APP_BASE}/api/sellers/{slug}/agent/auth`,
          manage_mcp:    `${APP_BASE}/sellers/{slug}/manage/mcp`,
          note:          'Only works once the store is approved (active) and has a contact email on record. The key is shown once and rotates on each auth.',
        },
        review_policy: 'Stores are reviewed for quality: nothing illegal, immoral, or offensive. Rejected stores stay offline and the reason is returned by get_store_status.',
        fee:           'Flat 2.5% network fee per sale, deducted on-chain at settlement. You keep 97.5%.',
      },
      tools_here: {
        list_sellers:     'Browse active sellers across the whole network',
        find_seller:      'Free-text search across the whole network',
        seller_mcp_url:   'Resolve a VIA-app slug to its per-seller MCP URL',
        register_store:   'Self-register a new store with your own wallets (pending human review)',
        get_store_status: 'Check whether your registered store is pending, approved, or rejected',
      },
    }),
  );

  // ── register_store ───────────────────────────────────────────────
  server.tool(
    'register_store',
    'Register your own store on the VIA network using two of your OWN wallets (no thirdweb, no human wizard). You bring a payout_wallet (USDC lands here, you keep 97.5%) and a DIFFERENT agent_wallet (holds your store\'s ERC-8004 identity). The flat 2.5% network fee is unchanged. Your store is created PENDING and stays invisible until a human reviews it for quality (nothing illegal, immoral, or offensive) within 24 hours. On approval the store goes live and the ERC-8004 identity is minted to your agent_wallet. Poll get_store_status with the returned slug to track the decision, then log into the returned dashboard_url to add and publish products.',
    {
      store_name:    z.string().min(1).max(120).describe('Public store / brand name, e.g. "Arc Lights".'),
      kind:          z.enum(['product', 'service', 'mixed']).describe('What you sell.'),
      payout_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base/EVM address').describe('Your USDC payout EOA on Base. Sale proceeds (97.5%) settle here.'),
      agent_wallet:  z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base/EVM address').describe('A DIFFERENT EOA that will hold your store\'s ERC-8004 agent identity. Must not equal payout_wallet.'),
      email:         z.string().email().max(200).describe('Contact email. Becomes the dashboard login once approved; keep it.'),
      password:      z.string().min(8).max(200).describe('Dashboard password (8+ chars). Keep it: this is how the store is managed after approval.'),
      slug:          z.string().min(1).max(60).optional().describe('Optional URL slug. Derived from store_name if omitted.'),
      description:   z.string().max(2000).optional().describe('What the store sells, for buyers and for review.'),
      headline:      z.string().max(200).optional().describe('Short one-line tagline.'),
      website_url:   z.string().url().max(300).optional().describe('Existing website, if any.'),
    },
    async ({ store_name, kind, payout_wallet, agent_wallet, email, password, slug, description, headline, website_url }) => {
      if (isRegisterRateLimited(clientIp(req))) {
        return asJson({ ok: false, code: 'rate_limited', error: 'Too many store registrations from this source. Wait a few minutes and retry.' });
      }
      const result = await createPendingAgentStore({
        storeName:    store_name,
        slug,
        kind,
        description:  description ?? null,
        headline:     headline ?? null,
        websiteUrl:   website_url ?? null,
        payoutWallet: payout_wallet,
        agentWallet:  agent_wallet,
        email,
        password,
      });
      if (!result.ok) return asJson(result);
      return asJson({
        ok:                   true,
        slug:                 result.slug,
        status:               result.status,
        approval_eligible_by: result.approval_eligible_at,
        dashboard_url:        result.dashboard_url,
        next: [
          `Poll get_store_status("${result.slug}") for the review decision (within 24 hours).`,
          'On approval your ERC-8004 agent id and per-seller MCP url are returned, and the store appears in list_sellers / find_seller.',
          `Log into ${result.dashboard_url} with your email + password to add and publish products.`,
        ],
        review_policy: 'Reviewed for quality: nothing illegal, immoral, or offensive. The store stays invisible until approved.',
        fee:           'Flat 2.5% network fee per sale. You keep 97.5% to your payout_wallet.',
      });
    },
  );

  // ── get_store_status ─────────────────────────────────────────────
  server.tool(
    'get_store_status',
    'Check the review status of a store you registered with register_store. Returns pending, approved, or rejected (with the reason). Once approved it also returns the ERC-8004 agent id and the per-seller MCP url.',
    {
      slug: z.string().min(1).max(60).describe('The slug returned by register_store.'),
    },
    async ({ slug }) => {
      const { data, error } = await db
        .from('app_sellers')
        .select('slug, name, active, approval_status, approval_eligible_at, erc8004_agent_id, created_via')
        .eq('slug', slug)
        .maybeSingle();
      if (error)  return asJson({ slug, found: false, error_code: 'lookup_failed', note: 'Could not look up the store right now. Retry shortly.' });
      if (!data)  return asJson({ slug, found: false, note: 'No store with that slug.' });

      const status = data.approval_status as string | null;
      if (status === 'approved' || (status === null && data.active)) {
        return asJson({
          slug:             data.slug,
          found:            true,
          status:           'approved',
          live:             data.active,
          erc8004_agent_id: data.erc8004_agent_id,
          mcp_url:          sellerMcpUrl(data.slug),
          dashboard_url:    `${APP_BASE}/seller/${data.slug}/admin`,
          message:          `${data.name} is live. Log into the dashboard to add and publish products.`,
        });
      }
      if (status && status.startsWith('rejected:')) {
        return asJson({
          slug:    data.slug,
          found:   true,
          status:  'rejected',
          reason:  status.slice('rejected:'.length),
          message: 'This store did not pass review. It stays offline. Address the reason and register again with a new store, or contact VIA.',
        });
      }
      return asJson({
        slug:                 data.slug,
        found:                true,
        status:               'pending',
        approval_eligible_by: data.approval_eligible_at,
        message:              'Awaiting human review (within 24 hours of submission). The store is not yet visible or sellable. Poll again later.',
      });
    },
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
    tools:       ['list_sellers', 'find_seller', 'seller_mcp_url', 'get_via_overview', 'register_store', 'get_store_status'],
  });
}

export async function POST(req: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createServer(req);
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
