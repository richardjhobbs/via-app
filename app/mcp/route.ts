/**
 * Central VIA app MCP endpoint, app.getvia.xyz/mcp
 *
 * Agents landing on the app's natural MCP URL discover products + sellers and
 * routing to per-seller endpoints here. Mirrors the discovery tools shipped on
 * the marketing-site MCP (www.getvia.xyz/mcp) but reads directly from
 * app_sellers / app_seller_products (this app has the live data; the marketing
 * site queries the same Supabase project but is rebuilt less often).
 *
 * Tools (27):
 *   Discovery      : list_sellers, find_seller, get_seller_products, seller_mcp_url,
 *                    submit_intent, find_buyers, get_taste_card, get_via_overview
 *   Onboard        : register_store, get_store_status, import_preference_appraisal
 *   Free pass      : claim_pass (no payment, no x402)
 *   Gateway/seller : get_product, get_shipping_quote, buy_product, confirm_purchase,
 *                    ask_sales_agent, get_offering_schema, request_quote, get_quote,
 *                    counter_quote, get_download_challenge, get_download_links , each
 *                    FORWARDS to the owning seller's MCP (mcp_ref.seller_mcp_url), so
 *                    the whole discovery -> quote -> buy -> settle loop runs here
 *   Gateway/buyer  : get_buyer_preferences, get_buyer_briefs, negotiate, accept_offer
 *                    , forwarded to a buyer's MCP so a seller can sell TO live demand
 *
 * The gateway tools reuse the per-seller / per-buyer MCP logic verbatim (one
 * implementation, no drift) and preserve the paid-door invariant: the same x402
 * settlement and the same paid brief door. FEDERATED MEMBERS (RRG): the buy loop
 * (get_product -> buy_product -> confirm_purchase) is translated to the member's
 * own contract (token_id + initiate/confirm); secondary seller tools return a
 * pointer to the member endpoint.
 *   submit_intent     : submit a buyer's intent; the full agentic matcher returns
 *                       genuine matches (requirements enforced) across the network
 *   find_buyers       : discover live DEMAND , buyers whose open briefs match what
 *                       you sell (redacted structured intent + buyer mcp_url)
 *   seller_mcp_url    : return + verify the per-seller MCP URL for a slug
 *   get_via_overview  : short pitch + entrypoint URLs for buyers / sellers
 *   register_store    : self-register a new store (pending human review)
 *   get_store_status  : check a registered store's review status
 *   import_preference_appraisal : a Mind (hellominds.ai) pushes a buyer's email-
 *                       derived shopping-preference appraisal (link-token authed)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { createPendingAgentStore } from '@/lib/app/store-registration';
import { fetchNetwork, searchNetwork, type NetworkResult } from '@/lib/app/network-search';
import { dryRunMatch, agenticNetworkSearch } from '@/lib/app/buyer-matching';
import { findOpenBriefs } from '@/lib/app/demand';
import { insertNotification } from '@/lib/app/notifications';
import { verifyMindLinkToken } from '@/lib/app/minds-link';
import { PreferenceAppraisalSchema, importPreferenceAppraisal } from '@/lib/app/minds-appraisal';
import { getPublishedCardBySlug, cardJson, cardUrl } from '@/lib/app/backroom/taste-cards';
import { getStoreCardBySlug, storeCardJson, storeCardUrl } from '@/lib/app/backroom/store-card';
import { claimEventPass } from '@/lib/app/event-passes';
import { forwardMcpTool, isMemberMcpUrl, memberCentralMcpUrl } from '@/lib/app/mcp-forward';
import { broadcastNetworkIntent } from '@/lib/app/network-intent';
import { after } from 'next/server';

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

// Federation lives in lib/app/network-search.ts (NETWORK_MEMBERS, fetchNetwork,
// searchNetwork, UnifiedProduct) so the buyer sourcing loop and this MCP tool
// search the same network. list_sellers below still fans out with fetchNetwork
// directly (it lists sellers, not products); find_seller uses searchNetwork.

// Per-member fan-out cap used when the caller did not set an explicit limit.
// High enough to return every member's full seller list today; each federated
// member still enforces its own ceiling on the HTTP call.
const NETWORK_FANOUT_MAX = 1000;

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
    description:      row.description ?? null,
    tags:             [],
  };
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

/** Normalise a name to alphanumerics only, lower-cased ("ADS&AI" -> "adsai"). */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface NamedStoreMatch {
  products: Record<string, unknown>[];
  sellers:  { source: string; name: string; kind: string; detail: string | null; mcp_url: string; page_url: string | null }[];
}

/**
 * Direct resolution of a query that NAMES a specific VIA store, e.g. "ADS&AI" or
 * "Ads & AI #12". The agentic matcher keys on meaning / vertical, so a store
 * whose name is an acronym with punctuation can be missed entirely while
 * federated brand-name noise (RRG "Adsum", etc.) fills the gap, which sends the
 * agent trawling the wrong platform. This does a normalised name/slug match over
 * the active-seller set (prefiltered by an ILIKE on the query's tokens so it
 * never scans the whole table) and returns the store plus its listings so
 * find_seller can surface them as THE answer. Deliberately strict: the store's
 * whole normalised name must sit inside the normalised query (or vice versa), so
 * "vinyl records" does not wrongly pin to a store called "Recycle Vinyl".
 */
async function resolveNamedViaStore(query: string, max: number): Promise<NamedStoreMatch | null> {
  const qn = normName(query);
  if (qn.length < 4) return null;
  const tokens = Array.from(new Set((query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
  if (tokens.length === 0) return null;

  const orFilter = tokens.flatMap((t) => [`name.ilike.%${t}%`, `slug.ilike.%${t}%`]).join(',');
  const { data: candidates } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, headline, description')
    .eq('active', true)
    .or(orFilter)
    .limit(50);

  const hits = (candidates ?? []).filter((s) => {
    const nn = normName(String(s.name ?? ''));
    const sn = normName(String(s.slug ?? ''));
    return (nn.length >= 4 && (qn.includes(nn) || nn.includes(qn)))
        || (sn.length >= 4 && (qn.includes(sn) || sn.includes(qn)));
  });
  if (hits.length === 0) return null;

  const products: Record<string, unknown>[] = [];
  const sellers:  NamedStoreMatch['sellers'] = [];
  for (const s of hits.slice(0, 3)) {
    const mcpUrl = sellerMcpUrl(s.slug as string);
    sellers.push({
      source: 'via', name: String(s.name), kind: String(s.kind ?? 'seller'),
      detail: (s.headline as string | null) ?? (s.description as string | null) ?? null,
      mcp_url: mcpUrl, page_url: null,
    });
    const { data: prods } = await db
      .from('app_seller_products')
      .select('id, title, description, price_minor, currency, stock, image_url, url, pricing_mode')
      .eq('seller_id', s.id)
      .eq('active', true)
      .eq('admin_removed', false)
      .in('on_chain_status', ['draft', 'registered'])
      .order('created_at', { ascending: false })
      .limit(max);
    for (const p of prods ?? []) {
      const priceUsdc  = (p.price_minor as number) / 1_000_000;
      const configurable = (p.pricing_mode as string) === 'configurable';
      products.push({
        source:        'via',
        title:         p.title,
        seller:        s.name,
        seller_slug:   s.slug,
        price_usdc:    priceUsdc,
        price_is_from: configurable,
        detail:        configurable ? 'configurable pricing: request a quote'
                     : (typeof p.stock === 'number' ? `${p.stock} in stock` : null),
        description:   p.description,
        image_url:     (p.image_url as string | null) ?? (p.url as string | null) ?? null,
        page_url:      `${APP_BASE}/sellers/${s.slug}/products/${p.id}`,
        mcp_ref:       { seller_mcp_url: mcpUrl, product_id: p.id, pricing_mode: p.pricing_mode },
        free_pass:     priceUsdc === 0,
      });
    }
  }
  return { products, sellers };
}

function createServer(req: Request) {
  const server = new McpServer({ name: 'via-app-discovery', version: '1.0.0' });

  server.tool(
    'list_sellers',
    'List active sellers across the VIA network (VIA app + RRG + integrated platforms). Each result is tagged with its platform and includes the per-seller MCP URL to connect to for deeper interaction (list_products, ask_sales_agent, buy_product).',
    {
      category: z.enum(['product', 'service', 'mixed']).optional().describe('Optional kind filter (applies to VIA-app sellers only).'),
      limit:    z.number().int().min(1).optional().describe('Optional cap on results. Omit to enumerate the ENTIRE network (no limit), which is the default.'),
    },
    async ({ category, limit }) => {
      // Enumerate ALL active VIA-app sellers. A fixed cap silently truncates the
      // network as it grows (and PostgREST itself stops at 1000 rows per request),
      // so page through in chunks until exhausted. `limit` is honoured only when
      // the caller explicitly sets one; the default is the whole network.
      const PAGE = 1000;
      const rows: SellerSummaryRow[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = db
          .from('app_sellers')
          .select('slug, name, kind, headline, description, website_url, erc8004_agent_id')
          .eq('active', true)
          .order('name', { ascending: true })
          .range(from, from + PAGE - 1);
        if (category) q = q.eq('kind', category);
        const { data, error } = await q;
        if (error) { console.error('[mcp/list_sellers] query failed:', error); break; }
        const chunk = (data ?? []) as SellerSummaryRow[];
        rows.push(...chunk);
        if (chunk.length < PAGE || (limit && rows.length >= limit)) break;
      }
      const network = await fetchNetwork('', limit ?? NETWORK_FANOUT_MAX);
      let sellers = [...rows.map(rowToSummary), ...network];
      if (limit) sellers = sellers.slice(0, limit);
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
      // Products come from the AGENTIC matcher (extract -> network recall ->
      // cross-vertical gate -> AI judge), so a natural-language query like
      // "sourdough bread" returns Eli's sourdough and not "Bread" the band, which
      // lexical FTS cannot disambiguate. Seller/brand profile hits (a seller whose
      // NAME or description matches, e.g. "a bakery") still come from the lexical
      // network search, run in parallel.
      const [agentic, net, named] = await Promise.all([
        agenticNetworkSearch(query, max),
        searchNetwork(query, max),
        resolveNamedViaStore(query, max),
      ]);

      // Any network check is live demand: after the response, broadcast the
      // intent as an anonymised teaser (category + product type + one attribute
      // only, never the raw text or any identity) onto the demand feed + The
      // Wire, so a concierge "just checking availability" still surfaces as
      // network activity. Runs via after() so it never adds latency to discovery,
      // and is deduped so repeated searches resurface instead of spamming.
      after(async () => { await broadcastNetworkIntent(query, agentic.intent); });

      // A query that NAMES a specific VIA store (e.g. "Ads & AI #12") resolves
      // directly to that store and its listings. Put those FIRST and dedupe the
      // agentic list against them, so a literal name never gets buried under
      // federated brand-name noise and the agent acts on the real target instead
      // of trawling other platforms.
      const namedProducts = named?.products ?? [];
      const namedSellers  = named?.sellers ?? [];
      const namedIds = new Set(namedProducts.map((p) => (p.mcp_ref as { product_id?: string } | undefined)?.product_id).filter(Boolean));
      const ranked = [
        ...namedProducts,
        ...agentic.products.filter((p) => {
          const pid = (p as { mcp_ref?: { product_id?: string } }).mcp_ref?.product_id;
          return !pid || !namedIds.has(pid);
        }),
      ];
      const namedMcpUrls = new Set(namedSellers.map((s) => s.mcp_url));
      const sellers = [...namedSellers, ...net.sellers.filter((s) => !namedMcpUrls.has(s.mcp_url))];

      // A named store resolved: return it as THE answer, decisively.
      if (namedProducts.length > 0) {
        return asJson({
          query,
          status: 'ok',
          count: ranked.length,
          results: ranked,
          sellers,
          next:
            'The query NAMES a specific VIA store, and its listings are at the TOP of `results` (source "via"). This is the match: act on it, do NOT trawl other sellers or platforms. For a listing with free_pass:true (price_usdc 0) call claim_pass with { product_id, name, email }. Otherwise call get_product then buy_product with the mcp_ref.seller_mcp_url and product_id. Ignore lower-ranked results from other sellers unless the user asks to compare.',
        });
      }

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

      // Seller-profile matches but no individual product hit (e.g. a seller whose
      // description says "I sell 3D assets for web games" whose listing text does
      // not contain the query words). The seller is a real match , surface it, and
      // tell the agent to drill into the catalogue rather than report "nothing".
      if (ranked.length === 0) {
        return asJson({
          query,
          status: 'ok',
          count: 0,
          results: [],
          sellers,              // seller / brand profile matches with no product hit
          next:
            'No individual product matched the query words, but the SELLERS in `sellers` match by their profile. Present them to the user by `name` with their `detail`, and offer to look inside their catalogue , do NOT say nothing is available. To see what each one actually stocks, call get_seller_products with that seller\'s `mcp_url` and the user\'s query.',
        });
      }

      return asJson({
        query,
        status: 'ok',
        count: ranked.length,
        results: ranked,        // blended, relevance-ranked products across the whole network
        sellers,                // seller / brand profile matches with no product hit
        next:
          'Present the best matches from `results` to the user, across ALL sources, with prices and the key differences. Every result has a working `page_url` (the direct product page) you give the user, plus `image_url` when one exists. ALSO check `sellers`: those are profile matches with no direct product hit , mention them by name and offer to drill in. If the user named a specific seller/brand, call get_seller_products with that result\'s mcp_ref.seller_mcp_url to drill in. To purchase: connect to mcp_ref.seller_mcp_url and call get_product then buy_product (or get_offering_schema + request_quote when pricing_mode is "configurable").',
      });
    },
  );

  // ── claim_pass (free event passes — routed from discovery, no x402) ───
  // The one action a buyer can complete straight from the network connector,
  // because it involves no money: a FREE guest-list pass. claimEventPass
  // validates the product is an active guest_list tier (price 0) and refuses
  // anything else, so a paid product can never settle here — its x402 door on
  // the per-seller MCP stays the only paid path (paid-door invariant).
  server.tool(
    'claim_pass',
    "Claim a FREE entry pass to an event on the VIA network, directly from discovery. FREE guest-list tiers only (price 0, the kind find_seller / get_seller_products surface at $0). No payment, no wallet, no x402: provide the attendee name and email, and VIA records the place, emails a confirmation, and notifies the organiser. One pass per email / per account. Paid products are NOT claimable here: connect to the seller's per-seller MCP and use buy_product (USDC via x402). Pass the product_id from a find_seller result (mcp_ref.product_id) or get_seller_products.",
    {
      product_id:     z.string().uuid().describe('UUID of the free pass tier, from a find_seller / get_seller_products result.'),
      name:           z.string().min(1).max(200).describe('Name of the person attending, for the guest list.'),
      email:          z.string().email().max(200).describe('Email to confirm the place to and for the organiser to admit by.'),
      buyer_wallet:   z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('Optional Base wallet, if the claimer has a VIA buyer identity.'),
      buyer_agent_id: z.string().optional().describe("Optional ERC-8004 agent id of the agent claiming on the buyer's behalf."),
    },
    async ({ product_id, name, email, buyer_wallet, buyer_agent_id }) => {
      // Resolve the tier's seller; claimEventPass re-checks the product belongs to
      // it and is a free guest_list tier, so this lookup only routes, never trusts.
      const { data: product } = await db
        .from('app_seller_products')
        .select('seller_id')
        .eq('id', product_id)
        .maybeSingle();
      if (!product) {
        return asJson({ claimed: false, error: 'not_found', message: 'No such product. Use the product_id from a find_seller / get_seller_products result.' });
      }
      const result = await claimEventPass({
        sellerId:     product.seller_id as string,
        productId:    product_id,
        name,
        email,
        buyerWallet:  buyer_wallet ?? null,
        buyerAgentId: buyer_agent_id ?? null,
        source:       'mcp_agent',
      });
      switch (result.outcome) {
        case 'confirmed':
          return asJson({ claimed: true, status: 'confirmed', event: result.eventName, tier: result.tierTitle, guest_id: result.guestId, message: `You are on the guest list for ${result.eventName}. A confirmation email is on its way. There was nothing to pay.` });
        case 'already':
          return asJson({ claimed: true, status: 'already_claimed', event: result.eventName, tier: result.tierTitle, message: 'This email or account already holds a pass for this tier. One pass per email / per account.' });
        case 'sold_out':
          return asJson({ claimed: false, error: 'sold_out', message: `"${result.tierTitle ?? 'This tier'}" has reached its allocation.` });
        case 'not_available':
          return asJson({ claimed: false, error: 'not_available', message: result.error ?? 'This is not a free pass. Paid products are bought with buy_product at the seller MCP, not claimed here.' });
        default:
          return asJson({ claimed: false, error: 'claim_failed', message: result.error ?? 'Could not record your place. Please retry.' });
      }
    },
  );

  // ── Gateway: transact without leaving the connector ──────────────────
  // get_product / get_shipping_quote / buy_product here FORWARD to the owning
  // seller's MCP (resolved from a find_seller / get_seller_products result's
  // mcp_ref.seller_mcp_url), so an agent on this one connector can go discovery
  // -> detail -> quote -> buy -> settle without attaching a second endpoint.
  // Forwarding reuses the per-seller MCP's full purchase logic (Stage-1 gate,
  // vouchers, free-pass routing, delivery/attendee validation, stock, x402), so
  // there is ONE implementation of each action and the gateway can never drift
  // from it. Settlement is unaffected: buy_product returns an absolute
  // /api/x402/purchase settle endpoint regardless of which MCP fronted the call.
  const viaAgentId = req.headers.get('x-via-agent-id');
  // VIA-native seller MCP (this app). Federated members (RRG) are reachable by
  // the forwarder but their identifier/arg translation lands in a later slice;
  // until then a member target returns an honest pointer, never a broken call.
  const isViaSellerUrl = (url: string): boolean => {
    try {
      const u = new URL(url);
      return (u.hostname === 'app.getvia.xyz' || u.hostname.endsWith('.getvia.xyz') || u.hostname === 'getvia.xyz')
        && /^\/sellers\/[^/]+\/mcp\/?$/.test(u.pathname);
    } catch { return false; }
  };
  const memberPending = (seller_mcp_url: string) => asJson({
    status:  'not_available_for_member',
    message: 'This action is not offered for network-member listings from the gateway. Buying IS: use get_product, then buy_product, then confirm_purchase. For anything else, connect to the seller_mcp_url and use its own tools.',
    seller_mcp_url,
  });

  server.tool(
    'get_product',
    'Fetch full detail for ONE listing before buying, from anywhere on the network, without leaving this connector. Pass the seller_mcp_url and product_id exactly as they appear in a find_seller / get_seller_products result (mcp_ref.seller_mcp_url and mcp_ref.product_id). Returns the listing with price, stock, and what the purchase requires. This forwards to the owning seller; the same buy loop (get_product -> get_shipping_quote -> buy_product) then settles here.',
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a find_seller / get_seller_products result.'),
      product_id:     z.string().min(1).describe('The listing id from discovery (mcp_ref.product_id).'),
    },
    async ({ seller_mcp_url, product_id }) => {
      if (isMemberMcpUrl(seller_mcp_url)) {
        // Members key a product by a numeric token id (mcp_ref.token_id).
        const r = await forwardMcpTool(seller_mcp_url, 'get_product', { token_id: Number(product_id) }, { viaAgentId });
        return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the member seller. Pass mcp_ref.token_id as product_id, or connect to the seller_mcp_url directly.', seller_mcp_url });
      }
      if (!isViaSellerUrl(seller_mcp_url)) return memberPending(seller_mcp_url);
      const r = await forwardMcpTool(seller_mcp_url, 'get_product', { product_id }, { viaAgentId });
      return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the seller to fetch this listing. Retry, or connect to the seller_mcp_url directly.', seller_mcp_url });
    },
  );

  server.tool(
    'get_shipping_quote',
    "Resolve a seller's shipping cost to a destination country before buying, without leaving this connector. Pass the seller_mcp_url from the listing's mcp_ref and the ISO 3166-1 alpha-2 country. Returns the flat rate, a per-order-quote signal, or a rejection. Call this before buy_product and pass buyer_country there to fold shipping into the total.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a find_seller / get_seller_products result.'),
      buyer_country:  z.string().min(2).max(2).describe('ISO 3166-1 alpha-2 destination country code (e.g. GB, US, JP).'),
    },
    async ({ seller_mcp_url, buyer_country }) => {
      if (isMemberMcpUrl(seller_mcp_url)) {
        return asJson({
          status:  'member_flow',
          message: 'This network member includes shipping in the purchase flow rather than a standalone quote. Call buy_product to get the payment total, then provide the shipping address at confirm_purchase.',
          buyer_country: buyer_country.toUpperCase(),
        });
      }
      if (!isViaSellerUrl(seller_mcp_url)) return memberPending(seller_mcp_url);
      const r = await forwardMcpTool(seller_mcp_url, 'get_shipping_quote', { buyer_country }, { viaAgentId });
      return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the seller for a shipping quote. Retry, or connect to the seller_mcp_url directly.', seller_mcp_url });
    },
  );

  server.tool(
    'buy_product',
    'Buy a listing from anywhere on the network, settled in USDC on Base, without leaving this connector. Pass the seller_mcp_url and product_id from the listing (mcp_ref). For physical products include the full delivery block; for event passes include the attendee block; the call rejects with the missing fields listed if any are blank. Free passes are not bought here: use claim_pass. Returns an x402 payment requirement and an order_ref, then settle at the absolute /api/x402/purchase endpoint it returns (sign an EIP-2612 USDC permit and POST { order_ref, x_payment }, OR send a raw USDC transfer to payTo and POST { order_ref, payment_tx_hash }). Call get_shipping_quote first and pass buyer_country to include shipping.',
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a find_seller / get_seller_products result.'),
      product_id:     z.string().min(1).describe('The listing id from discovery (mcp_ref.product_id).'),
      qty:            z.number().int().min(1).max(1000).default(1),
      buyer_wallet:   z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base wallet address').describe('The buyer wallet that will settle in USDC on Base.'),
      buyer_agent_id: z.string().optional().describe("ERC-8004 agent id of the Buying Agent acting on the buyer's behalf."),
      buyer_country:  z.string().length(2).optional().describe('ISO 3166-1 alpha-2 destination country. Required when the seller ships; folds the shipping quote into the total.'),
      delivery:       z.object({
        name:          z.string().min(1).max(200),
        address_line1: z.string().min(1).max(200),
        address_line2: z.string().max(200).optional(),
        city:          z.string().min(1).max(120),
        region:        z.string().max(120).optional(),
        postcode:      z.string().min(1).max(40),
        country:       z.string().length(2).describe('ISO 3166-1 alpha-2; must match buyer_country if both are supplied'),
        phone:         z.string().min(4).max(40),
      }).optional().describe('Required for physical products. Omit for digital / service.'),
      attendee:       z.object({
        name:    z.string().min(1).max(200).describe('Full name of the person the pass is for.'),
        email:   z.string().email().max(200).describe('Email the organiser will send the pass and any follow-up to.'),
        country: z.string().min(2).max(60).describe('Attendee country (name or ISO code), for the organiser.'),
      }).optional().describe('Required for event passes.'),
      selected_size:  z.string().optional().describe('Variant size, for network-member products that have a size axis (e.g. S, M, L). Ignored by VIA-native listings.'),
      selected_color: z.string().optional().describe('Variant colour, for network-member products that have a colour axis. Ignored by VIA-native listings.'),
    },
    async ({ seller_mcp_url, product_id, buyer_wallet, selected_size, selected_color, ...rest }) => {
      if (isMemberMcpUrl(seller_mcp_url)) {
        // Member buy: RRG's per-brand buy_product returns payment instructions
        // (USDC on Base); the buyer then sends USDC and calls confirm_purchase.
        // Its contract is token_id + size/color + buyer_wallet, not x402.
        const r = await forwardMcpTool(seller_mcp_url, 'buy_product', {
          token_id: Number(product_id), size: selected_size, color: selected_color, buyer_wallet,
        }, { viaAgentId });
        const next = { next_step: 'After sending the USDC, call confirm_purchase with the same seller_mcp_url, token_id (as product_id), buyer_wallet, and your USDC tx hash.' };
        return asJson(r.ok ? { ...(r.payload as object), ...next } : { error: r.error ?? 'forward_failed', message: 'Could not reach the member seller to place this order. Connect to the seller_mcp_url directly.', seller_mcp_url });
      }
      if (!isViaSellerUrl(seller_mcp_url)) return memberPending(seller_mcp_url);
      const r = await forwardMcpTool(seller_mcp_url, 'buy_product', { product_id, buyer_wallet, ...rest }, { viaAgentId });
      return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the seller to place this order. Retry, or connect to the seller_mcp_url directly.', seller_mcp_url });
    },
  );

  server.tool(
    'confirm_purchase',
    "Settle a network-MEMBER (e.g. RRG) purchase after you have sent the USDC that buy_product asked for. This is the member two-step: buy_product returns a pay-to address and amount, you transfer USDC on Base, then call this with the tx hash to mint, pay out, and get your download. For physical products include the shipping block and buyer_email. VIA-native purchases do NOT use this: they settle at the /api/x402/purchase endpoint that buy_product returns.",
    {
      seller_mcp_url: z.string().min(1).describe('The member seller_mcp_url you called buy_product on.'),
      product_id:     z.string().min(1).describe('The member listing/token id (mcp_ref.token_id).'),
      buyer_wallet:   z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('The wallet that sent the USDC.'),
      tx_hash:        z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe('The USDC transfer transaction hash on Base.'),
      buyer_email:    z.string().email().optional().describe('For order confirmation and file delivery. Required for physical products.'),
      buyer_agent_id: z.number().int().positive().optional().describe('Your ERC-8004 agent id, for an on-chain trust signal.'),
      selected_size:  z.string().optional().describe('The size you chose at buy_product (must match).'),
      selected_color: z.string().optional().describe('The colour you chose at buy_product (must match).'),
      shipping:       z.object({
        name:          z.string().min(1).max(200),
        address_line1: z.string().min(1).max(200),
        address_line2: z.string().max(200).optional(),
        city:          z.string().min(1).max(120),
        state:         z.string().max(120).optional(),
        postal_code:   z.string().min(1).max(40),
        country:       z.string().min(2).max(60),
        phone:         z.string().min(4).max(40),
      }).optional().describe('Required for physical member products.'),
    },
    async ({ seller_mcp_url, product_id, buyer_wallet, tx_hash, buyer_email, buyer_agent_id, selected_size, selected_color, shipping }) => {
      const central = memberCentralMcpUrl(seller_mcp_url);
      if (!central) {
        return asJson({ error: 'not_a_member', message: 'confirm_purchase settles network-member purchases only. VIA-native orders settle at the /api/x402/purchase endpoint that buy_product returned.', seller_mcp_url });
      }
      const r = await forwardMcpTool(central, 'confirm_agent_purchase', {
        tokenId:     Number(product_id),
        buyerWallet: buyer_wallet,
        txHash:      tx_hash,
        ...(buyer_email    ? { buyerEmail: buyer_email }     : {}),
        ...(buyer_agent_id ? { buyerAgentId: buyer_agent_id } : {}),
        ...(selected_size  ? { selected_size }  : {}),
        ...(selected_color ? { selected_color } : {}),
        ...(shipping ? {
          shipping_name:          shipping.name,
          shipping_address_line1: shipping.address_line1,
          shipping_address_line2: shipping.address_line2,
          shipping_city:          shipping.city,
          shipping_state:         shipping.state,
          shipping_postal_code:   shipping.postal_code,
          shipping_country:       shipping.country,
          shipping_phone:         shipping.phone,
        } : {}),
      }, { viaAgentId });
      return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the member to confirm this purchase. Retry, or connect to the member central MCP directly.', central_mcp_url: central });
    },
  );

  // Forward a seller-scoped tool: VIA-native forwards; a member (RRG) target
  // returns the honest pointer until member translation is wired (slice 4).
  const fwdSeller = async (seller_mcp_url: string, tool: string, args: Record<string, unknown>) => {
    if (!isViaSellerUrl(seller_mcp_url)) return memberPending(seller_mcp_url);
    const r = await forwardMcpTool(seller_mcp_url, tool, args, { viaAgentId });
    return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the seller. Retry, or connect to the seller_mcp_url directly.', seller_mcp_url });
  };
  // A VIA per-buyer MCP (this app). Buyers are VIA-only (no member buyer MCPs).
  const isViaBuyerUrl = (url: string): boolean => {
    try {
      const u = new URL(url);
      return (u.hostname === 'app.getvia.xyz' || u.hostname.endsWith('.getvia.xyz') || u.hostname === 'getvia.xyz')
        && /^\/buyers\/[^/]+\/mcp\/?$/.test(u.pathname);
    } catch { return false; }
  };
  const fwdBuyer = async (buyer_mcp_url: string, tool: string, args: Record<string, unknown>) => {
    if (!isViaBuyerUrl(buyer_mcp_url)) return asJson({ error: 'not_a_via_buyer', message: 'Pass a VIA buyer MCP url (…/buyers/{handle}/mcp) from a find_buyers result.', buyer_mcp_url });
    const r = await forwardMcpTool(buyer_mcp_url, tool, args, { viaAgentId });
    return asJson(r.ok ? r.payload : { error: r.error ?? 'forward_failed', message: 'Could not reach the buyer. Retry, or connect to the buyer_mcp_url directly.', buyer_mcp_url });
  };

  // ── Gateway: seller Sales Agent, quotes, downloads (forwarded) ────────
  server.tool(
    'ask_sales_agent',
    "Ask a seller's Sales Agent a question, from anywhere on the network, without leaving this connector. It answers in the seller's voice using their locked-in memories (events, promotions, policies, stock). Pass the seller_mcp_url from a discovery result and an optional contact so the seller can reach back.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a find_seller / get_seller_products result.'),
      question:       z.string().min(1).max(2000).describe('Free-form buyer question.'),
      contact:        z.string().max(300).optional().describe('Optional reach-back identifier (email, handle, or the buyer agent MCP url).'),
    },
    async ({ seller_mcp_url, question, contact }) => fwdSeller(seller_mcp_url, 'ask_sales_agent', { question, contact }),
  );

  server.tool(
    'get_offering_schema',
    "Fetch the configurable option space for a per-order (configurable) product before requesting a quote, forwarded to the owning seller. Returns option groups, choices, quantity rules and surcharges. Fixed-price products have no schema; buy those with buy_product.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a discovery result.'),
      product_id:     z.string().min(1).describe('The configurable product id from discovery.'),
    },
    async ({ seller_mcp_url, product_id }) => fwdSeller(seller_mcp_url, 'get_offering_schema', { product_id }),
  );

  server.tool(
    'request_quote',
    "Request an advisory price for a configurable product, forwarded to the owning seller. Pass the selections from get_offering_schema. Returns a quote_ref and a NON-BINDING proposed_total the seller reviews. Poll get_quote for the decision.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a discovery result.'),
      product_id:     z.string().min(1),
      selections: z.object({
        options:  z.record(z.string(), z.any()).describe('Map of option group key to the chosen value.'),
        quantity: z.number().int().min(1).max(100000).optional().describe('Order quantity (default 1).'),
      }),
      spec:    z.record(z.string(), z.any()).optional().describe('Free-form brief: deadline, artwork notes. Not priced, surfaced to the seller.'),
      contact: z.string().max(300).optional().describe('Reach-back identifier so the seller can follow up.'),
    },
    async ({ seller_mcp_url, ...args }) => fwdSeller(seller_mcp_url, 'request_quote', args),
  );

  server.tool(
    'get_quote',
    "Check a quote's status by quote_ref, forwarded to the owning seller. Returns the current status, the binding total once approved, and the negotiation thread.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a discovery result.'),
      quote_ref:      z.string().min(3).max(40).describe('The quote_ref from request_quote, e.g. "QUO-2605-7K3PQM".'),
    },
    async ({ seller_mcp_url, quote_ref }) => fwdSeller(seller_mcp_url, 'get_quote', { quote_ref }),
  );

  server.tool(
    'counter_quote',
    "Counter an existing quote, forwarded to the owning seller. Pass the quote_ref and a target price, revised selections, or both. Appends a round to the negotiation; stays non-binding until the seller approves.",
    {
      seller_mcp_url:     z.string().min(1).describe('mcp_ref.seller_mcp_url from a discovery result.'),
      quote_ref:          z.string().min(3).max(40),
      counter_total_usdc: z.number().min(0).optional().describe('Your proposed price for the configuration.'),
      selections: z.object({
        options:  z.record(z.string(), z.any()),
        quantity: z.number().int().min(1).max(100000).optional(),
      }).optional().describe('Revised configuration, if you are changing what you want.'),
      note: z.string().max(1000).optional().describe('Free-form message to the seller.'),
    },
    async ({ seller_mcp_url, ...args }) => fwdSeller(seller_mcp_url, 'counter_quote', args),
  );

  server.tool(
    'get_download_challenge',
    "Begin retrieving a digital deliverable you bought, forwarded to the owning seller. Returns a message to SIGN with the paying wallet plus a challenge token; then call get_download_links.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a discovery result.'),
      product_id:     z.string().min(1).describe('The purchased digital product id.'),
      buyer_wallet:   z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('The wallet that settled the purchase.'),
    },
    async ({ seller_mcp_url, product_id, buyer_wallet }) => fwdSeller(seller_mcp_url, 'get_download_challenge', { product_id, buyer_wallet }),
  );

  server.tool(
    'get_download_links',
    "Retrieve time-limited download links for a digital product you bought and settled, forwarded to the owning seller. Call get_download_challenge first, sign the message with the paying wallet, then call this with the challenge and signature.",
    {
      seller_mcp_url: z.string().min(1).describe('mcp_ref.seller_mcp_url from a discovery result.'),
      product_id:     z.string().min(1).describe('The purchased digital product id.'),
      buyer_wallet:   z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('The wallet that settled the purchase.'),
      challenge:      z.string().min(8).describe('The challenge token from get_download_challenge.'),
      signature:      z.string().min(8).describe('Signature of the challenge message, signed by buyer_wallet.'),
    },
    async ({ seller_mcp_url, ...args }) => fwdSeller(seller_mcp_url, 'get_download_links', args),
  );

  // ── Gateway: buyer side, sell TO live demand (forwarded) ──────────────
  server.tool(
    'get_buyer_preferences',
    "Read a buyer's public buying preferences, forwarded to their buyer MCP. Pass the buyer_mcp_url from a find_buyers result. Delegation caps and private notes are never exposed.",
    { buyer_mcp_url: z.string().min(1).describe("A buyer's mcp_url from a find_buyers result (…/buyers/{handle}/mcp).") },
    async ({ buyer_mcp_url }) => fwdBuyer(buyer_mcp_url, 'get_buyer_preferences', {}),
  );

  server.tool(
    'get_buyer_briefs',
    "See a buyer's OPEN demand as free teasers, forwarded to their buyer MCP. Each teaser carries a paid door_url: the FULL brief and the ability to offer are paid at that x402 door, not here. Use a teaser to decide if your stock fits, then go to the door.",
    { buyer_mcp_url: z.string().min(1).describe("A buyer's mcp_url from a find_buyers result.") },
    async ({ buyer_mcp_url }) => fwdBuyer(buyer_mcp_url, 'get_buyer_briefs', {}),
  );

  server.tool(
    'negotiate',
    "Negotiate a PAID offer with a buyer's Buying Agent, forwarded to their buyer MCP. This is the post-door step: submit a paid offer at the brief door first (POST /api/via/brief/[brief_id]/offer), then pass that brief_id and the offer's payment_tx_hash here. There is no free pre-door pitch.",
    {
      buyer_mcp_url:   z.string().min(1).describe("The buyer's mcp_url from a find_buyers result."),
      brief_id:        z.string().min(1).describe('The brief you made a paid offer against.'),
      payment_tx_hash: z.string().min(1).describe('The on-chain payment tx from your door offer.'),
      offer_text:      z.string().min(1).max(4000).describe('Your full pitch: what you are offering, terms, and price.'),
    },
    async ({ buyer_mcp_url, ...args }) => fwdBuyer(buyer_mcp_url, 'negotiate', args),
  );

  server.tool(
    'accept_offer',
    "Ask a buyer's Buying Agent to accept a negotiated offer, forwarded to their buyer MCP. The agent auto-accepts only within the buyer's delegation caps, otherwise it queues the offer for the buyer's approval.",
    {
      buyer_mcp_url: z.string().min(1).describe("The buyer's mcp_url from a find_buyers result."),
      offer_id:      z.string().min(1).max(120).describe('Your reference id for the offer being accepted.'),
      amount_usd:    z.number().min(0).optional().describe('Total order amount in USD, for the caps check.'),
      category:      z.string().min(1).max(60).optional().describe("Product category, checked against the buyer's lists."),
    },
    async ({ buyer_mcp_url, ...args }) => fwdBuyer(buyer_mcp_url, 'accept_offer', args),
  );

  server.tool(
    'submit_intent',
    "Submit a buyer's INTENT in their own words. Two things happen: (1) you get back the products across the VIA network that genuinely match it, from the full agentic matcher (it reads each product's data and reasons, it is not keyword search); and (2) the intent is BROADCAST live onto the network as an anonymised teaser (category + product type + one attribute only, never the raw text or any identity), so it appears on The Wire (app.getvia.xyz/wire) and sellers can respond. Use this when you are buying ON BEHALF of someone and want defined matches plus live broadcast. State the brief naturally, including any hard requirements (\"raw selvedge denim, 32 waist\", \"first pressing on the Stiff label\", \"a gift of coffee\"). Hard requirements are enforced (a product that fails one is excluded); broad briefs return on-category options. Returns matches with seller, price, a direct page_url, and the mcp_url to transact, plus broadcast:true and a door_url when the intent went live. For matching AND broadcast tied to a specific VIA buyer's saved taste and budget (and seller pitch-back), call submit_intent on that buyer's MCP (/buyers/{handle}/mcp) instead.",
    {
      brief: z.string().min(2).max(2000).describe("What the buyer wants, in plain words, e.g. 'made in japan raw selvedge denim around 32 waist' or 'a gift of coffee for a family member'."),
    },
    async ({ brief }) => {
      const { intent, results } = await dryRunMatch(brief);
      // Broadcast the intent as an ANONYMISED teaser onto the demand feed + The
      // Wire (filed under the dedicated public "via-network-demand" buyer). Only
      // the category / product type / one attribute surface, never the raw text
      // or any identity. Non-fatal: discovery still returns even if this no-ops.
      const teaser = await broadcastNetworkIntent(brief, intent);
      const broadcast = teaser
        ? { broadcast: true, on_the_wire: true, door_url: teaser.door_url }
        : { broadcast: false };
      if (results.length === 0) {
        return asJson({
          brief,
          status: 'need_more_info',
          understood: intent,
          results: [],
          ...broadcast,
          guidance:
            'Nothing on the network matches this intent YET, but your intent is now broadcast live on the network (visible on The Wire at app.getvia.xyz/wire) so sellers can respond as they join. This is NOT proof it is unavailable. Ask one clarifying question to sharpen the brief, or retry with a broader phrasing.',
          suggested_dimensions: CLARIFY_DIMENSIONS,
        });
      }
      return asJson({
        brief,
        status: 'ok',
        understood: intent,        // how the matcher read the brief (requirements vs preferences)
        count: results.length,
        results,                   // genuine matches, ranked; each has seller, price, page_url, mcp_url
        ...broadcast,              // broadcast:true + door_url when the intent went onto the demand feed / The Wire
        next: 'Present these to the buyer with prices and key differences. The intent is also broadcast live on the network (The Wire) so other sellers can respond. To purchase, connect to a result\'s mcp_url and call get_product then buy_product.',
      });
    },
  );

  server.tool(
    'find_buyers',
    "Discover live DEMAND: buyers who are actively looking for what you sell. Search by what you have ('raw selvedge denim', 'first pressing acid jazz vinyl', 'cold brew coffee') and get back buyers whose open briefs match, each with the buyer's structured intent (category, hard requirements, budget , never their raw wording) and the buyer's mcp_url. This is the demand mirror of find_seller: instead of a buyer searching catalogues, a seller finds buyers who want their stock. Omit query to browse recent open demand. To act: connect to a buyer's mcp_url and call pitch_against_brief (judged) or negotiate.",
    {
      query: z.string().optional().describe("What you have to offer, e.g. 'raw selvedge denim' or 'acid jazz vinyl'. Omit to browse recent demand."),
      limit: z.number().int().min(1).max(50).optional().describe('Max buyers to return (default 10).'),
    },
    async ({ query, limit }) => {
      const max = Math.min(Math.max(limit ?? 10, 1), 50);
      const buyers = await findOpenBriefs((query ?? '').replace(/[%,()]/g, ' ').trim(), max);
      if (buyers.length === 0) {
        return asJson({
          query: query ?? '',
          status: 'need_more_info',
          buyers: [],
          guidance:
            'No open demand matched yet. This is NOT proof no one wants it. Retry with a broader term, a synonym, the category, or omit the query to browse all current demand. Buyers post briefs continuously.',
          suggested_dimensions: CLARIFY_DIMENSIONS,
        });
      }
      return asJson({
        query: query ?? '',
        status: 'ok',
        count: buyers.length,
        buyers,
        next: 'Each buyer has open briefs (structured intent) and an mcp_url. If you have a genuine match, connect to mcp_url and call pitch_against_brief with the brief_id and your product , the buyer\'s agent judges the fit and notifies the buyer. Or call negotiate to make an offer.',
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
        summary:    'Agents can register their own store over this MCP with a SINGLE wallet, no thirdweb, no human wizard. You only need your payout_wallet (your USDC EOA); the platform creates your store ERC-8004 identity wallet for you. The VIA network keeps a flat 2.5% fee on each sale; you keep 97.5% to your payout wallet. Your store gets its own ERC-8004 identity on approval.',
        how: [
          '1. Call register_store with: store_name, kind (product|service|mixed), a payout_wallet (your USDC EOA), plus a contact email + password you keep for the dashboard. That is the ONLY wallet you provide; the platform creates and operates your ERC-8004 identity wallet for you.',
          '2. Your store is created PENDING and stays invisible (not in list_sellers / find_seller, no per-seller MCP) until a human reviews it. Review happens within 24 hours.',
          '3. Poll get_store_status with your slug. On "approved" the store is live, the ERC-8004 agent id is minted to your store identity wallet, and your per-seller MCP url is returned.',
          '4. Manage your catalogue agent-to-agent over MCP, no dashboard: connect to /sellers/{slug}/manage/mcp, get_challenge({ wallet }) signing with your payout_wallet, sign the message with that wallet, authenticate({ wallet, challenge, signature }) to get a session_token, then create_product and publish_product.',
        ],
        manage_after_approval: {
          manage_mcp:    `${APP_BASE}/sellers/{slug}/manage/mcp`,
          auth:          'wallet-signature: get_owner_management_info -> get_challenge -> sign with the wallet you control -> authenticate -> session_token',
          discover:      'Call get_owner_management_info on the public per-seller MCP to learn the manage url. Sign with your payout_wallet.',
          note:          'Only works once the store is approved (active) with a contact email on record. Sign with your payout_wallet (the only wallet you control; the identity wallet is platform-operated).',
        },
        review_policy: 'Stores are reviewed for quality: nothing illegal, immoral, or offensive. Rejected stores stay offline and the reason is returned by get_store_status.',
        fee:           'Flat 2.5% network fee per sale, deducted on-chain at settlement. You keep 97.5%.',
      },
      tools_here: {
        list_sellers:     'Browse active sellers across the whole network',
        get_seller_products: 'Drill into one seller/brand catalogue (pass its mcp_url) to answer "is X available at seller Y", with prices, in-stock sizes, and direct product links.',
        find_seller:      'Search products and sellers across the whole network. Defined intent returns `results`, one relevance-ranked list blending every source. Each result has a working page_url (direct product page), image_url when one exists, and an mcp_ref to transact. Multiple matches should be shown with their differences. A loose / zero-match query returns need_more_info: ask a clarifying question or broaden, never say "nothing available".',
        claim_pass:       'Claim a FREE guest-list pass ($0 tier) straight from discovery with name + email. No payment, no wallet, no x402.',
        get_product:      'Full detail for one listing before buying, forwarded to the owning seller. Pass mcp_ref.seller_mcp_url + mcp_ref.product_id from a discovery result.',
        get_shipping_quote: 'Shipping cost to a country for a listing, forwarded to the seller. Call before buy_product.',
        buy_product:      'Place a paid order from this connector: forwards to the owning seller. VIA-native returns an x402 USDC requirement + order_ref (settle at /api/x402/purchase); a network member (RRG) returns pay-to instructions, then call confirm_purchase. Discovery -> get_product -> buy_product -> settle, all from one connector.',
        confirm_purchase: 'Settle a network-MEMBER (RRG) purchase after sending the USDC buy_product asked for: pass the tx hash to mint, pay out, and get your download. VIA-native orders do not use this (they settle at /api/x402/purchase).',
        seller_mcp_url:   'Resolve a VIA-app slug to its per-seller MCP URL',
        register_store:   'Self-register a new store with a single payout wallet, the platform creates your identity wallet (pending human review)',
        get_store_status: 'Check whether your registered store is pending, approved, or rejected',
      },
    }),
  );

  // ── register_store ───────────────────────────────────────────────
  server.tool(
    'register_store',
    'Register your own store on the VIA network (no thirdweb, no human wizard). You only need ONE wallet: your payout_wallet (USDC lands here, you keep 97.5%). The platform creates and operates your store\'s ERC-8004 identity wallet for you; you do not supply or hold it. The flat 2.5% network fee is unchanged. Your store is created PENDING and stays invisible until a human reviews it for quality (nothing illegal, immoral, or offensive) within 24 hours. On approval the store goes live and its ERC-8004 identity is minted. Poll get_store_status with the returned slug to track the decision.',
    {
      store_name:    z.string().min(1).max(120).describe('Public store / brand name, e.g. "Arc Lights".'),
      kind:          z.enum(['product', 'service', 'mixed']).describe('What you sell.'),
      payout_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base/EVM address').describe('Your USDC payout EOA on Base. Sale proceeds (97.5%) settle here. This is the only wallet you need.'),
      email:         z.string().email().max(200).describe('Contact email. Becomes the dashboard login once approved; keep it.'),
      password:      z.string().min(8).max(200).describe('Dashboard password (8+ chars). Keep it: this is how the store is managed after approval.'),
      slug:          z.string().min(1).max(60).optional().describe('Optional URL slug. Derived from store_name if omitted.'),
      description:   z.string().max(2000).optional().describe('What the store sells, for buyers and for review.'),
      headline:      z.string().max(200).optional().describe('Short one-line tagline.'),
      website_url:   z.string().url().max(300).optional().describe('Existing website, if any.'),
    },
    async ({ store_name, kind, payout_wallet, email, password, slug, description, headline, website_url }) => {
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

  // ── import_preference_appraisal ──────────────────────────────────
  // The Minds side of the email -> shopping-preferences feature. A Mind
  // (hellominds.ai) reads the owner's email INSIDE the Mind, appraises how they
  // shop, and pushes the structured result here with the link token the owner
  // minted in their VIA dashboard. VIA never sees raw email. Taste becomes soft
  // preference memories; budget becomes a PROPOSED cap the owner approves.
  server.tool(
    'import_preference_appraisal',
    "Import a buyer's shopping-preference appraisal (derived by a Mind from the owner's email) onto their VIA buying agent. Requires a link_token the owner minted in their VIA dashboard; it scopes the write to exactly one buyer. Pass the structured appraisal (categories, brands, sizes, cadence, budget signal). VIA never receives raw email. Taste signals shape matching and negotiation immediately; the budget signal becomes a PROPOSED spending cap that the owner must approve in the dashboard before it gates any autonomous spend.",
    {
      link_token: z.string().min(1).describe('The link token the buyer owner minted in their VIA dashboard (POST /api/buyer/[buyerId]/appraisal action=mint_link).'),
      appraisal:  PreferenceAppraisalSchema.describe('The structured shopping-preference appraisal. Use evidence_summary for prose only; never include raw quoted email.'),
    },
    async ({ link_token, appraisal }) => {
      const verified = verifyMindLinkToken(link_token);
      if (!verified.ok) return asJson({ ok: false, error: `invalid link token: ${verified.error}` });

      const { data: buyer } = await db
        .from('app_buyers')
        .select('id, handle, owner_user_id')
        .eq('id', verified.payload.buyer_id)
        .maybeSingle();
      if (!buyer || buyer.handle !== verified.payload.handle) {
        return asJson({ ok: false, error: 'buyer not found for this token' });
      }

      let result;
      try {
        result = await importPreferenceAppraisal(buyer.id as string, appraisal);
      } catch (err) {
        console.error('[mcp/import_preference_appraisal] import failed:', err);
        return asJson({ ok: false, error: 'failed to import appraisal' });
      }

      const reviewPath = `/buyer/${buyer.handle}/admin/buying-agent`;
      const hasProposedCaps = Object.keys(result.proposedCaps).length > 0;

      void insertNotification({
        ownerUserId: buyer.owner_user_id as string,
        kind:        'system',
        title:       'Your Mind appraised your shopping preferences',
        body:        hasProposedCaps
          ? `${result.inserted + result.updated} preference signal(s) imported, plus proposed spending caps awaiting your approval.`
          : `${result.inserted + result.updated} preference signal(s) imported from your email appraisal.`,
        link:        reviewPath,
        metadata:    { source: 'minds-email', buyer_id: buyer.id, ...result },
      });

      return asJson({
        ok:            true,
        buyer:         { handle: buyer.handle },
        imported:      { inserted: result.inserted, updated: result.updated },
        proposed_caps: hasProposedCaps ? result.proposedCaps : null,
        review_url:    `${APP_BASE}${reviewPath}`,
        next: hasProposedCaps
          ? 'Preferences imported. Proposed spending caps are waiting for the owner to approve in the dashboard before they take effect.'
          : 'Preferences imported onto the buying agent.',
      });
    },
  );

  // ── get_taste_card ───────────────────────────────────────────────
  // Read ONE published card by its slug (from a shared link). Deliberately no
  // list or search companion: taste cards are shared person to person, never
  // browsed as a directory.
  server.tool(
    'get_taste_card',
    'Read a published VIA taste card by its slug: the public, human-curated identity subset (references, obsessions, aesthetic words, anti-references) plus the member agent address. Cards are shared by their owners; there is no directory or search. Returns not_published for unknown or unpublished slugs.',
    {
      slug: z.string().min(3).max(40).describe('The card slug from a shared link, e.g. app.getvia.xyz/taste/<slug>.'),
    },
    async ({ slug }) => {
      const card = await getPublishedCardBySlug(slug);
      if (!card) return asJson({ status: 'not_published', message: 'No published taste card at this slug.' });
      return asJson({ ...cardJson(card), card_url: cardUrl(card) });
    },
  );

  // ── get_store_card ───────────────────────────────────────────────
  // Read a room-graduated store's marketing card: the co-created product, its
  // price, the co-creators with verifiable identity, and the buy pointer.
  server.tool(
    'get_store_card',
    'Read a VIA store card by its slug: a product co-created by members of a Back Room, with its price, the co-creators (name, share, payout wallet, ERC-8004 id), and how to buy it (the seller MCP buy_product tool over the x402 door). Returns not_found for unknown slugs.',
    {
      slug: z.string().min(2).max(60).describe('The store slug from a shared link, e.g. app.getvia.xyz/store/<slug>.'),
    },
    async ({ slug }) => {
      const card = await getStoreCardBySlug(slug);
      if (!card) return asJson({ status: 'not_found', message: 'No store card at this slug.' });
      return asJson({ ...storeCardJson(card), card_url: storeCardUrl(card.slug) });
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
    tools:       ['list_sellers', 'find_seller', 'get_seller_products', 'seller_mcp_url', 'get_via_overview', 'register_store', 'get_store_status', 'import_preference_appraisal', 'get_taste_card', 'get_store_card'],
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
