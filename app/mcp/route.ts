/**
 * Central VIA app MCP endpoint, app.getvia.xyz/mcp
 *
 * Agents landing on the app's natural MCP URL discover products + sellers and
 * routing to per-seller endpoints here. Mirrors the discovery tools shipped on
 * the marketing-site MCP (www.getvia.xyz/mcp) but reads directly from
 * app_sellers / app_seller_products (this app has the live data; the marketing
 * site queries the same Supabase project but is rebuilt less often).
 *
 * Tools (6):
 *   list_sellers      : active VIA sellers, paginated, with per-seller MCP URL
 *   find_seller       : product + seller search; returns product-level results
 *                       (direct web_url + mcp_ref) or need_more_info when loose
 *   seller_mcp_url    : return + verify the per-seller MCP URL for a slug
 *   get_via_overview  : short pitch + entrypoint URLs for buyers / sellers
 *   register_store    : self-register a new store (pending human review)
 *   get_store_status  : check a registered store's review status
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { createPendingAgentStore } from '@/lib/app/store-registration';
import { searchCatalog } from '@/lib/app/seller-catalog';

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

// Dimensions an assistant should ask about to turn a loose query into defined
// intent. Returned in the need_more_info block so the model clarifies rather
// than declaring "nothing available".
const CLARIFY_DIMENSIONS = [
  'category or product type',
  'budget or price ceiling (USDC)',
  'brand, maker, or author',
  'intended use, occasion, or recipient',
  'key attributes (size, material, format, etc.)',
];

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
    "Search the VIA network (VIA app + RRG + integrated platforms) for PRODUCTS and the sellers that offer them. Matches the published product catalogue (titles, descriptions, authors, categories) AND seller profiles, so 'books', an author, a title, or a category surfaces the actual product even when the seller's name does not contain the word. " +
      "WHEN INTENT IS DEFINED: returns product-level results. Each product carries `web_url` (a direct link to the product page on the VIA network you can give the user) and `mcp_ref` (the seller MCP url + product_id + token_id you use to transact). If more than one product matches, PRESENT THEM TO THE USER side by side with prices and the key differences explained; do not just pick one silently. " +
      "WHEN INTENT IS LOOSE OR THERE IS NO MATCH: the response is `status: 'need_more_info'` with `suggested_dimensions`. DO NOT reply 'nothing is available'. Ask the user ONE clarifying question to sharpen intent (budget, brand/author, category, use), or retry this tool with a broader term, a synonym, the category, or the brand/author name. Only after a genuinely broadened retry also returns nothing should you say you could not find a match, and even then frame it as 'not found yet', not 'does not exist'.",
    {
      query: z.string().min(1).describe("What the user wants. Searches product catalogues AND seller profiles, e.g. 'raw denim jeans', 'Arnaud Frade', 'sourdough', or 'custom embroidered polo'."),
      limit: z.number().int().min(1).max(50).optional().describe('Max product results to return (default 10).'),
    },
    async ({ query, limit }) => {
      const max = Math.min(Math.max(limit ?? 10, 1), 50);
      const safe = query.replace(/[%,()]/g, ' ').trim();
      const [local, network] = await Promise.all([
        searchCatalog(safe, max),
        fetchNetwork(safe, max),
      ]);
      const total = local.products.length + local.sellers.length + network.length;

      if (total === 0) {
        return asJson({
          query,
          status: 'need_more_info',
          products: [],
          sellers: [],
          guidance:
            "No catalogue or directory text matched on VIA yet. This is NOT proof the item is unavailable. Do NOT tell the user nothing is available. Ask one clarifying question to sharpen intent, or call find_seller again with a broader term, a synonym, the category, or the brand/author name.",
          suggested_dimensions: CLARIFY_DIMENSIONS,
        });
      }

      return asJson({
        query,
        status: 'ok',
        count: total,
        products: local.products,            // product-level: title, price, web_url (direct link), mcp_ref to transact
        via_sellers: local.sellers,          // VIA-app sellers matched by profile with no product hit
        network_sellers: network,            // sellers on other VIA members (e.g. RRG), connect to mcp_url for their catalogue
        next:
          'If `products` has more than one entry, present them to the user with prices and the key differences, each with its web_url (direct product link). To purchase: connect to a product mcp_ref.seller_mcp_url and call get_product then buy_product (or get_offering_schema + request_quote when pricing_mode is "configurable"). For network_sellers, connect to mcp_url and call list_products.',
      });
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
      network:         'list_sellers and find_seller federate across every VIA network member (VIA app + RRG + integrated platforms). find_seller matches both seller profiles and their product catalogues, so author/title/category queries resolve to the seller that stocks them. Results are seller pointers tagged by platform; connect to each result mcp_url for the catalogue and the buy. A zero result is a directory/catalogue-index miss, not proof of absence: broaden the query or connect to a likely seller and call list_products before concluding the item is unavailable.',
      agent_self_onboard: {
        summary:    'Agents can register their own store over this MCP with two of their own wallets, no thirdweb, no human wizard. The VIA network keeps a flat 2.5% fee on each sale; you keep 97.5% to your payout wallet. Your store gets its own ERC-8004 identity on approval.',
        how: [
          '1. Call register_store with: store_name, kind (product|service|mixed), a payout_wallet (your USDC EOA) and a DIFFERENT agent_wallet (your ERC-8004 identity EOA), plus a contact email + password you keep for the dashboard.',
          '2. Your store is created PENDING and stays invisible (not in list_sellers / find_seller, no per-seller MCP) until a human reviews it. Review happens within 24 hours.',
          '3. Poll get_store_status with your slug. On "approved" the store is live, the ERC-8004 agent id is minted to your agent_wallet, and your per-seller MCP url is returned.',
          '4. Manage your catalogue agent-to-agent over MCP, no dashboard: connect to /sellers/{slug}/manage/mcp, call get_challenge({ wallet: <your agent_wallet> }), sign the message with that wallet, authenticate({ wallet, challenge, signature }) to get a session_token, then create_product and publish_product. The public per-seller MCP also exposes get_owner_management_info with these steps.',
        ],
        manage_after_approval: {
          manage_mcp:    `${APP_BASE}/sellers/{slug}/manage/mcp`,
          auth:          'wallet-signature: get_challenge -> sign with agent_wallet -> authenticate -> session_token',
          discover:      'Call get_owner_management_info on the public per-seller MCP to learn the manage url and which wallet to sign with.',
          note:          'Only works once the store is approved (active) with a contact email on record, and only the agent_wallet on record can authenticate.',
        },
        review_policy: 'Stores are reviewed for quality: nothing illegal, immoral, or offensive. Rejected stores stay offline and the reason is returned by get_store_status.',
        fee:           'Flat 2.5% network fee per sale, deducted on-chain at settlement. You keep 97.5%.',
      },
      tools_here: {
        list_sellers:     'Browse active sellers across the whole network',
        find_seller:      'Search products and sellers across the whole network. Defined intent returns product-level results with a direct web_url and an mcp_ref to transact; multiple matches should be shown to the user with their differences. A loose / zero-match query returns need_more_info: ask a clarifying question or broaden, never say "nothing available".',
        seller_mcp_url:   'Resolve a VIA-app slug to its per-seller MCP URL',
        register_store:   'Self-register a new store with your own wallets (pending human review)',
        get_store_status: 'Check whether your registered store is pending, approved, or rejected',
      },
    }),
  );

  // ── register_store ───────────────────────────────────────────────
  server.tool(
    'register_store',
    'Register your own store on the VIA network (no thirdweb, no human wizard). You only need ONE wallet: your payout_wallet (USDC lands here, you keep 97.5%). The platform creates your store\'s ERC-8004 identity wallet for you, so leave agent_wallet out unless you specifically want to supply your own (a DIFFERENT EOA from payout_wallet). The flat 2.5% network fee is unchanged. Your store is created PENDING and stays invisible until a human reviews it for quality (nothing illegal, immoral, or offensive) within 24 hours. On approval the store goes live and its ERC-8004 identity is minted. Poll get_store_status with the returned slug to track the decision.',
    {
      store_name:    z.string().min(1).max(120).describe('Public store / brand name, e.g. "Arc Lights".'),
      kind:          z.enum(['product', 'service', 'mixed']).describe('What you sell.'),
      payout_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base/EVM address').describe('Your USDC payout EOA on Base. Sale proceeds (97.5%) settle here. This is the only wallet you need.'),
      agent_wallet:  z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base/EVM address').optional().describe('OPTIONAL. Leave this out and the platform creates your store\'s ERC-8004 identity wallet for you (recommended: you only need your payout_wallet). Only supply it if you want to use your own DIFFERENT EOA for the identity; it must not equal payout_wallet.'),
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
