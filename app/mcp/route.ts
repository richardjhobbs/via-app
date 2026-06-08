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
import { searchCatalog, type PublicProduct } from '@/lib/app/seller-catalog';
import { relevanceScore } from '@/lib/app/via-search';

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
  image:       string | null;
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
      image:    r?.image ?? null,
    })).filter((r) => r.name && r.mcp_url);
  } catch {
    return [];
  }
}

async function fetchNetwork(q: string, max: number): Promise<NetworkResult[]> {
  const batches = await Promise.all(NETWORK_MEMBERS.map((m) => fetchMember(m, q, max)));
  return batches.flat();
}

// ── Unified product result ───────────────────────────────────────────
// One shape for every product match, whether it is a VIA-app listing or a
// federated network member's (RRG). Agentic commerce: the agent must see ALL
// products in one ranked list, regardless of source. Every searchable product
// has a working product page, so `page_url` is always set; `image_url` may be
// null. Transact over `mcp_ref`.
interface UnifiedProduct {
  source:        string;                 // 'via' | 'rrg' | future member
  title:         string;
  seller:        string | null;
  price_usdc:    number | null;
  price_is_from: boolean;                // true when price is a configurable "from" base
  detail:        string | null;          // stock / sizes / pricing note for the human
  image_url:     string | null;
  page_url:      string | null;          // direct product page
  mcp_ref:       { seller_mcp_url: string; product_id?: string; token_id?: number | null; pricing_mode?: string };
}

function viaToUnified(p: PublicProduct): UnifiedProduct {
  const detail = p.pricing_mode === 'configurable'
    ? 'configurable pricing: request a quote'
    : (typeof p.stock === 'number' ? `${p.stock} in stock` : null);
  return {
    source:        'via',
    title:         p.title,
    seller:        p.seller_name,
    price_usdc:    p.price_usdc,
    price_is_from: p.price_is_from,
    detail,
    image_url:     p.image_url,
    page_url:      p.product_url,
    mcp_ref:       p.mcp_ref,
  };
}

// RRG /api/via/search returns name + a "Brand · 245.70 USDC · in stock: …"
// detail blob. Pull the brand name and price out of it for the merged shape;
// keep the full blob as `detail` for the sizes the human wants.
function networkToUnified(r: NetworkResult): UnifiedProduct {
  const brand = r.detail ? (r.detail.split('·')[0]?.trim() || null) : null;
  const priceMatch = r.detail ? r.detail.match(/([0-9]+(?:\.[0-9]+)?)\s*USDC/i) : null;
  return {
    source:        r.platform,
    title:         r.name,
    seller:        brand,
    price_usdc:    priceMatch ? Number(priceMatch[1]) : null,
    price_is_from: false,
    detail:        r.detail,
    image_url:     r.image,
    page_url:      r.web_url,
    mcp_ref:       { seller_mcp_url: r.mcp_url },
  };
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
    image:            null,
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
      limit:    z.number().int().min(1).max(500).optional().describe('Max sellers to return per platform (default 200, enough to enumerate the whole network).'),
    },
    async ({ category, limit }) => {
      const max = Math.min(Math.max(limit ?? 200, 1), 500);
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
      "WHEN INTENT IS DEFINED: returns `results`, ONE relevance-ranked list blending every source. Each result carries a working `page_url` (the direct product page you give the user), plus `seller`, `price_usdc`, `image_url` (or null when the listing has no picture), and `mcp_ref` to transact. If more than one matches, PRESENT THEM side by side with prices and the key differences; do not silently pick one. " +
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

      // Split federated hits: products go into the ranked product list, anything
      // else (brand / seller profiles) into the seller pointer list.
      const networkProducts = network.filter((r) => r.kind === 'product');
      const networkSellers  = network.filter((r) => r.kind !== 'product');

      // One blended pool of products across every source, ranked by relevance to
      // the query so the best options surface first regardless of platform or
      // whether the listing has an image. Stable sort keeps VIA-app data-only
      // listings from being drowned by the larger RRG catalogue at equal scores.
      const pool: UnifiedProduct[] = [
        ...local.products.map(viaToUnified),
        ...networkProducts.map(networkToUnified),
      ];
      const ranked = pool
        .map((item) => ({ item, score: relevanceScore(`${item.title} ${item.seller ?? ''} ${item.detail ?? ''}`, safe) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item)
        .slice(0, max);

      // Seller / brand profile matches with no product hit, both sources.
      const sellers = [
        ...local.sellers.map((s) => ({
          source: 'via', name: s.name, kind: s.kind,
          detail: s.headline ?? s.description, mcp_url: s.mcp_url, page_url: s.page_url,
        })),
        ...networkSellers.map((r) => ({
          source: r.platform, name: r.name, kind: r.kind,
          detail: r.detail, mcp_url: r.mcp_url, page_url: r.web_url,
        })),
      ];

      if (ranked.length === 0 && sellers.length === 0) {
        return asJson({
          query,
          status: 'need_more_info',
          results: [],
          sellers: [],
          guidance:
            "No catalogue or directory text matched on VIA yet. This is NOT proof the item is unavailable. Do NOT tell the user nothing is available. Ask one clarifying question to sharpen intent, or call find_seller again with a broader term, a synonym, the category, or the brand/author name.",
          suggested_dimensions: CLARIFY_DIMENSIONS,
        });
      }

      return asJson({
        query,
        status: 'ok',
        count: ranked.length,
        results: ranked,        // blended, relevance-ranked products across the whole network
        sellers,                // seller / brand profile matches with no product hit
        next:
          'Present the best matches from `results` to the user, across ALL sources, with prices and the key differences. Every result has a working `page_url` (the direct product page) you give the user, plus `image_url` when one exists. If the user named a specific seller/brand, call get_seller_products with that result\'s mcp_ref.seller_mcp_url to drill in. To purchase: connect to mcp_ref.seller_mcp_url and call get_product then buy_product (or get_offering_schema + request_quote when pricing_mode is "configurable").',
      });
    },
  );

  server.tool(
    'get_seller_products',
    "Drill into ONE seller's catalogue to answer 'is X available at seller Y'. Pass the seller_mcp_url from a find_seller / list_sellers result (a VIA-app seller or an RRG brand). Returns that seller's products matching your query (or its whole catalogue if query is omitted), each with price, in-stock sizes where known, and a direct web_url to the product page. Use this right after find_seller whenever the user names a specific seller or brand, e.g. 'raw denim jeans in size 36 at Standard & Strange'.",
    {
      seller_mcp_url: z.string().min(1).describe('The mcp_url from a find_seller / list_sellers result, e.g. https://realrealgenuine.com/brand/standard-and-strange/mcp or https://app.getvia.xyz/sellers/the-sentient-startup/mcp'),
      query: z.string().optional().describe("What to look for in that seller's catalogue, e.g. 'raw denim jean'. Omit to list the whole catalogue."),
      limit: z.number().int().min(1).max(50).optional().describe('Max products to return (default 15).'),
    },
    async ({ seller_mcp_url, query, limit }) => {
      const max = Math.min(Math.max(limit ?? 15, 1), 50);
      const m = seller_mcp_url.match(/^https?:\/\/([^/]+)\/(?:brand|sellers)\/([^/]+)\/mcp\/?$/i);
      if (!m) {
        return asJson({ error: 'unrecognised seller_mcp_url', hint: 'Pass the mcp_url exactly as returned by find_seller (…/brand/{slug}/mcp or …/sellers/{slug}/mcp).' });
      }
      const base = `https://${m[1]}`;
      const slug = m[2];
      try {
        const u = `${base}/api/via/search?seller=${encodeURIComponent(slug)}&q=${encodeURIComponent(query ?? '')}&limit=${max}`;
        const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return asJson({ seller: slug, products: [], error: `origin returned ${res.status}` });
        const json = await res.json() as { results?: unknown; products?: unknown };
        const products = Array.isArray(json.products) ? json.products : (Array.isArray(json.results) ? json.results : []);
        return asJson({
          seller: slug,
          query: query ?? null,
          count: products.length,
          products,
          next: products.length === 0
            ? 'No matching products at this seller. Broaden the query, or omit query to list the whole catalogue.'
            : 'Each product has a web_url (direct link); RRG products include in-stock sizes in detail. To buy, connect to the seller mcp_url and use its get_product / buy_product tools.',
        });
      } catch {
        return asJson({ seller: slug, products: [], error: 'origin_unreachable' });
      }
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
        get_seller_products: 'Drill into one seller/brand catalogue (pass its mcp_url) to answer "is X available at seller Y", with prices, in-stock sizes, and direct product links.',
        find_seller:      'Search products and sellers across the whole network. Defined intent returns `results`, one relevance-ranked list blending every source. Each result has a working page_url (direct product page), image_url when one exists, and an mcp_ref to transact. Multiple matches should be shown with their differences. A loose / zero-match query returns need_more_info: ask a clarifying question or broaden, never say "nothing available".',
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
    tools:       ['list_sellers', 'find_seller', 'get_seller_products', 'seller_mcp_url', 'get_via_overview', 'register_store', 'get_store_status'],
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
