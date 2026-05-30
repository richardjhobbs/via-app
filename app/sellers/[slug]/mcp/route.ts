/**
 * Per-seller MCP endpoint — app.getvia.xyz/sellers/[slug]/mcp
 *
 * Buying agents discover sellers via the central getvia.xyz/mcp
 * (list_sellers / find_seller / seller_mcp_url) and connect here for
 * deeper interaction. Stateless per request — a fresh McpServer is
 * built and torn down for each call, so we can run on Vercel's
 * Edge / serverless runtime without holding session state in memory.
 *
 * Tools (5):
 *   list_products    — active, on-chain-registered listings
 *   get_product      — single listing with on-chain stock
 *   get_seller_info  — public seller card (name, kind, MCP URL, agent IDs)
 *   ask_sales_agent  — proxy to DeepSeek with the seller's voice memories
 *   buy_product      — returns an x402 payment requirement; full settlement
 *                      (operatorMint + auto-payout) is wired separately at
 *                      /api/x402/purchase. v1 records the intent and the
 *                      payment requirement; v1.1 closes the loop.
 *
 * Every call is logged to app_mcp_interactions with the parsed agent
 * identity (ERC-8004 ID from `x-via-agent-id` header when present, IP
 * fallback otherwise).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { ethers } from 'ethers';
import { getShippingConfig, computeShippingQuote, type ShippingConfig } from '@/lib/app/shipping';
import { insertNotification } from '@/lib/app/notifications';
import { conciergeKeyFor } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

// ── Helpers ──────────────────────────────────────────────────────────

interface SellerRow {
  id:                   string;
  slug:                 string;
  name:                 string;
  kind:                 string;
  headline:             string | null;
  description:          string | null;
  website_url:          string | null;
  contact_email:        string;
  wallet_address:       string;
  agent_wallet_address: string | null;
  erc8004_seller_id:    string | null;
  erc8004_agent_id:     string | null;
  active:               boolean;
  shipping:             unknown; // raw jsonb; pass through getShippingConfig() before use
  owner_user_id:        string;  // auth.users.id of the seller account, used for notifications
  purchase_policy:      string | null; // free-form note surfaced via get_seller_info
  hermes_concierge_status: string | null; // null | 'pending' | 'provisioned' | 'failed:<msg>'
  hermes_concierge_url:    string | null; // endpoint the Hermes-side Sales Agent answers on
}

async function loadSeller(slug: string): Promise<SellerRow | null> {
  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, headline, description, website_url, contact_email, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, active, shipping, owner_user_id, purchase_policy, hermes_concierge_status, hermes_concierge_url')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data as SellerRow;
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function publicSellerInfo(s: SellerRow) {
  return {
    slug:             s.slug,
    name:             s.name,
    kind:             s.kind,
    headline:         s.headline,
    description:      s.description,
    website_url:      s.website_url,
    erc8004_seller_id: s.erc8004_seller_id,
    erc8004_agent_id:  s.erc8004_agent_id,
    agent_wallet:     s.agent_wallet_address,
    mcp_url:          `${APP_BASE}/sellers/${s.slug}/mcp`,
    purchase_policy:  s.purchase_policy,
  };
}

async function logInteraction(
  sellerId: string,
  toolName: string,
  agentIdentity: Record<string, unknown>,
  request: unknown,
  response: unknown,
  statusCode: number,
  durationMs: number,
) {
  // Fire-and-forget — never block the tool response on the audit write.
  db.from('app_mcp_interactions').insert({
    seller_id:      sellerId,
    tool_name:      toolName,
    agent_identity: agentIdentity,
    request,
    response,
    status_code:    statusCode,
    duration_ms:    durationMs,
  }).then(() => {}, (err) => {
    console.warn(`[mcp] audit log insert failed for ${toolName}:`, err);
  });
}

function parseAgentIdentity(req: Request): Record<string, unknown> {
  const viaAgentId = req.headers.get('x-via-agent-id');
  const ua         = req.headers.get('user-agent');
  const fwd        = req.headers.get('x-forwarded-for');
  const ip         = fwd ? fwd.split(',')[0].trim() : null;
  return {
    via_agent_id: viaAgentId ? Number(viaAgentId) : null,
    user_agent:   ua,
    ip,
  };
}

// ── Rate limiting (best-effort, per warm instance) ───────────────────
// Keyed by ip|agent over a sliding 60s window. The stateless transport
// means this is per-lambda-instance, which is enough to blunt abusive
// bursts (e.g. buy_product / ask_sales_agent spam). Mirrors the buyer MCP
// route limiter.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateHits = new Map<string, number[]>();

function rateLimitKey(req: Request): string {
  const identity = parseAgentIdentity(req);
  return `${identity.ip ?? 'noip'}|${identity.via_agent_id ?? 'noagent'}`;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(key, hits);
  return hits.length > RATE_MAX;
}

// ── Build the MCP server per-request ─────────────────────────────────

function createServer(seller: SellerRow, req: Request) {
  const server = new McpServer({
    name: `${seller.slug}-sales-agent`,
    version: '1.0.0',
  });

  const identity = parseAgentIdentity(req);

  // ── list_products ────────────────────────────────────────────────
  server.tool(
    'list_products',
    `List ${seller.name}'s active, on-chain-registered listings. Returns each product's title, description, price (USDC), stock (when known), and the ERC-1155 tokenId on Base mainnet for buy_product follow-up.`,
    {
      active_only: z.boolean().optional().describe('Filter to active=true (default true)'),
      limit:       z.number().int().min(1).max(100).optional().describe('Max products to return (default 50)'),
    },
    async ({ active_only, limit }) => {
      const t0 = Date.now();
      const max = Math.min(Math.max(limit ?? 50, 1), 100);
      let query = db
        .from('app_seller_products')
        .select('id, title, description, kind, price_minor, currency, stock, url, token_id, on_chain_status, max_supply')
        .eq('seller_id', seller.id)
        .eq('on_chain_status', 'registered')
        .order('created_at', { ascending: false })
        .limit(max);
      if (active_only !== false) query = query.eq('active', true);

      const { data, error } = await query;
      const products = (data ?? []).map((p) => ({
        product_id:    p.id,
        title:         p.title,
        description:   p.description,
        kind:          p.kind,
        price_usdc:    (p.price_minor as number) / 1_000_000,
        currency:      p.currency,
        stock:         p.stock,
        url:           p.url,
        token_id:      p.token_id,
        max_supply:    p.max_supply,
      }));
      const out = asJson({ seller: seller.slug, count: products.length, products });
      void logInteraction(seller.id, 'list_products', identity, { active_only, limit }, { count: products.length }, error ? 500 : 200, Date.now() - t0);
      return out;
    },
  );

  // ── get_product ──────────────────────────────────────────────────
  server.tool(
    'get_product',
    `Fetch a single ${seller.name} listing by product_id.`,
    {
      product_id: z.string().uuid().describe('UUID returned by list_products'),
    },
    async ({ product_id }) => {
      const t0 = Date.now();
      const { data, error } = await db
        .from('app_seller_products')
        .select('id, title, description, kind, price_minor, currency, stock, url, token_id, on_chain_status, max_supply, metadata')
        .eq('id', product_id)
        .eq('seller_id', seller.id)
        .maybeSingle();
      if (error || !data) {
        const r = asJson({ error: `product ${product_id} not found for ${seller.slug}` });
        void logInteraction(seller.id, 'get_product', identity, { product_id }, { error: 'not_found' }, 404, Date.now() - t0);
        return r;
      }
      const out = asJson({
        product_id:    data.id,
        title:         data.title,
        description:   data.description,
        kind:          data.kind,
        price_usdc:    (data.price_minor as number) / 1_000_000,
        currency:      data.currency,
        stock:         data.stock,
        url:           data.url,
        token_id:      data.token_id,
        max_supply:    data.max_supply,
        on_chain_status: data.on_chain_status,
        metadata:      data.metadata,
      });
      void logInteraction(seller.id, 'get_product', identity, { product_id }, { found: true }, 200, Date.now() - t0);
      return out;
    },
  );

  // ── get_seller_info ──────────────────────────────────────────────
  server.tool(
    'get_seller_info',
    `Public information about ${seller.name} — name, kind, description, website, ERC-8004 IDs, and the agent's own wallet address.`,
    {},
    async () => {
      const t0 = Date.now();
      const out = asJson(publicSellerInfo(seller));
      void logInteraction(seller.id, 'get_seller_info', identity, {}, { ok: true }, 200, Date.now() - t0);
      return out;
    },
  );

  // ── ask_sales_agent ──────────────────────────────────────────────
  server.tool(
    'ask_sales_agent',
    `Ask ${seller.name}'s Sales Agent a question. The agent answers in the seller's voice using its locked-in memories (events, promotions, policies, stock notes). Pass an optional 'contact' string (email, telegram handle, Buying Agent MCP URL, or whatever you accept) so the seller can reach back if a follow-up needs a human touch.`,
    {
      question: z.string().min(1).max(2000).describe('Free-form buyer question'),
      contact:  z.string().max(300).optional().describe('Optional reach-back identifier for the buyer or their agent so the seller can follow up. Examples: "buyer@example.com", "@buyerhandle", "https://buyer.example/agent/mcp".'),
    },
    async ({ question, contact }) => {
      const t0 = Date.now();
      const trimmedContact = contact?.trim().slice(0, 300) || null;
      const result = await askSalesAgent(seller, question, trimmedContact);
      const out = asJson({
        seller:       seller.slug,
        question,
        answer:       result.answer,
        agent_status: result.agent_status,
        delegated_to: result.delegated_to,
      });
      void logInteraction(
        seller.id,
        'ask_sales_agent',
        identity,
        { question: question.slice(0, 200), contact: trimmedContact },
        { len: result.answer.length, agent_status: result.agent_status, delegated: Boolean(result.delegated_to) },
        200,
        Date.now() - t0,
      );
      void insertNotification({
        ownerUserId: seller.owner_user_id,
        kind:        'enquiry',
        title:       'New enquiry from a buying agent',
        body:        question.slice(0, 240),
        link:        `/seller/${seller.slug}/admin/sales-agent`,
        metadata:    {
          tool_name:      'ask_sales_agent',
          agent_identity: identity,
          contact:        trimmedContact,
          seller_id:      seller.id,
          agent_status:   result.agent_status,
          delegated_to:   result.delegated_to,
        },
      });
      return out;
    },
  );

  // ── get_shipping_quote ──────────────────────────────────────────
  server.tool(
    'get_shipping_quote',
    `Resolve ${seller.name}'s shipping policy for a destination country. Returns the flat-rate cost (USD), or a 'pending_merchant_quote' signal when the seller quotes per order, or a rejection when the destination is excluded. Buying agents should call this before buy_product so they know the full landed cost.`,
    {
      buyer_country: z.string().min(2).max(2).describe('ISO 3166-1 alpha-2 destination country code (e.g. GB, US, JP).'),
    },
    async ({ buyer_country }) => {
      const t0 = Date.now();
      const config: ShippingConfig | null = getShippingConfig(seller.shipping);
      const quote = computeShippingQuote(config, buyer_country);
      const out = asJson({ seller: seller.slug, buyer_country: buyer_country.toUpperCase(), quote });
      void logInteraction(seller.id, 'get_shipping_quote', identity, { buyer_country }, { status: quote.status }, 200, Date.now() - t0);
      void insertNotification({
        ownerUserId: seller.owner_user_id,
        kind:        'enquiry',
        title:       'Buying agent priced shipping',
        body:        `Quote requested for ${buyer_country.toUpperCase()} (status: ${quote.status})`,
        link:        `/seller/${seller.slug}/admin/shipping`,
        metadata:    { tool_name: 'get_shipping_quote', agent_identity: identity, buyer_country: buyer_country.toUpperCase(), quote_status: quote.status, seller_id: seller.id },
      });
      return out;
    },
  );

  // ── buy_product (v1 — returns x402 payment requirement) ─────────
  server.tool(
    'buy_product',
    `Initiate a purchase of one of ${seller.name}'s listings. For physical products you MUST pass the full delivery block (name, address_line1, city, postcode, country, phone) — the call will reject with missing_delivery_details listing required_fields if any are blank. Digital and service kinds do not require delivery. Read get_seller_info().purchase_policy first to learn what the seller specifically needs. Returns an x402 payment requirement (USDC, product + shipping) and an order_ref ("VIA-YYMM-XXXXXX") the seller will reference. SETTLE WITH EITHER of two methods at /api/x402/purchase: (a) x402 permit (sign-not-send): sign an EIP-2612 USDC permit authorising payTo to pull maxAmountRequired and POST { order_ref, x_payment }; the endpoint pulls the USDC. OR (b) raw transfer: send a plain USDC transfer of at least maxAmountRequired to payTo from your buyer_wallet, then POST { order_ref, payment_tx_hash }; the endpoint verifies the on-chain transfer. Either way it then fires operatorMint + 97.5/2.5 USDC payout. For the raw-transfer path the transfer must come from the same buyer_wallet on the order, and each tx settles at most one order. Call get_shipping_quote first to know the shipping cost; pass buyer_country to fold it in here.`,
    {
      product_id:     z.string().uuid(),
      qty:            z.number().int().min(1).max(1000).default(1),
      buyer_wallet:   z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base wallet address'),
      buyer_agent_id: z.string().optional().describe('ERC-8004 agent ID of the Buying Agent acting on the buyer\'s behalf'),
      buyer_country:  z.string().length(2).optional().describe('ISO 3166-1 alpha-2 destination country code. Required when the seller has shipping configured; the quote is included in the x402 total. Omit for digital / service kinds that do not ship.'),
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
    },
    async ({ product_id, qty, buyer_wallet, buyer_agent_id, buyer_country, delivery }) => {
      const t0 = Date.now();

      const { data: product, error: prodErr } = await db
        .from('app_seller_products')
        .select('id, title, price_minor, currency, stock, token_id, on_chain_status, active, max_supply, kind')
        .eq('id', product_id)
        .eq('seller_id', seller.id)
        .maybeSingle();
      if (prodErr || !product) {
        const r = asJson({ error: `product ${product_id} not found for ${seller.slug}` });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'not_found' }, 404, Date.now() - t0);
        return r;
      }
      if (!product.active || product.on_chain_status !== 'registered') {
        const r = asJson({ error: `product ${product_id} is not currently purchasable (status=${product.on_chain_status}, active=${product.active})` });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'not_purchasable' }, 409, Date.now() - t0);
        return r;
      }
      if (product.currency !== 'USDC') {
        const r = asJson({ error: `non-USDC pricing not supported in v1 (got ${product.currency})` });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'unsupported_currency' }, 400, Date.now() - t0);
        return r;
      }

      // ── Stock / supply gate ───────────────────────────────────
      // Reject oversell before we record an intent or quote a payment.
      // `stock` is the seller-tracked available count (null = untracked).
      // `max_supply` is the on-chain edition ceiling; one order can never
      // exceed it. Both are checked when present.
      const stockNum     = typeof product.stock === 'number' ? product.stock : null;
      const maxSupplyNum  = typeof product.max_supply === 'number' ? product.max_supply : null;
      if (stockNum !== null && qty > stockNum) {
        const r = asJson({ error: 'insufficient_stock', message: `Only ${stockNum} unit(s) of "${product.title}" remain; requested ${qty}.`, available: stockNum, requested: qty });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'insufficient_stock', available: stockNum }, 409, Date.now() - t0);
        return r;
      }
      if (maxSupplyNum !== null && qty > maxSupplyNum) {
        const r = asJson({ error: 'exceeds_max_supply', message: `"${product.title}" has an edition cap of ${maxSupplyNum}; a single order cannot request ${qty}.`, max_supply: maxSupplyNum, requested: qty });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'exceeds_max_supply', max_supply: maxSupplyNum }, 409, Date.now() - t0);
        return r;
      }

      if (!ethers.isAddress(buyer_wallet)) {
        const r = asJson({ error: 'buyer_wallet is not a valid EVM address' });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'invalid_buyer_wallet' }, 400, Date.now() - t0);
        return r;
      }

      // ── Delivery gate (physical products only) ────────────────
      // Digital and service kinds skip address collection. For physical
      // products, every field below is mandatory so the seller can ship
      // without follow-up. The buyer's agent should call get_seller_info
      // first, read purchase_policy, gather the fields from its principal,
      // then call buy_product. A clear required_fields list lets the agent
      // re-prompt the buyer precisely.
      if (product.kind === 'physical') {
        const required: Array<keyof NonNullable<typeof delivery>> = ['name', 'address_line1', 'city', 'postcode', 'country', 'phone'];
        const missing  = !delivery ? required : required.filter((k) => !delivery[k] || String(delivery[k]).trim().length === 0);
        if (missing.length > 0) {
          const r = asJson({
            error: 'missing_delivery_details',
            message: `${seller.name} ships physical orders and requires full delivery details before a payment requirement can be issued.`,
            required_fields: missing,
            purchase_policy: seller.purchase_policy,
          });
          void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet, has_delivery: !!delivery }, { error: 'missing_delivery_details', missing }, 400, Date.now() - t0);
          return r;
        }
        if (buyer_country && delivery!.country.toUpperCase() !== buyer_country.toUpperCase()) {
          const r = asJson({ error: 'country_mismatch', message: `buyer_country (${buyer_country.toUpperCase()}) and delivery.country (${delivery!.country.toUpperCase()}) must agree.` });
          void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet, buyer_country, delivery_country: delivery!.country }, { error: 'country_mismatch' }, 400, Date.now() - t0);
          return r;
        }
      }

      // ── Shipping resolution ────────────────────────────────────
      const shippingConfig = getShippingConfig(seller.shipping);
      const shippingQuote = buyer_country
        ? computeShippingQuote(shippingConfig, buyer_country)
        : null;

      // Reject up front if the seller has shipping configured and the
      // buyer's country is excluded / unsupported. quote_on_purchase is
      // allowed through with shipping_usd=0 (seller confirms later).
      if (shippingQuote && (shippingQuote.status === 'country_excluded' || shippingQuote.status === 'not_shipping_internationally')) {
        const r = asJson({
          error: `Cannot ship to ${('shipsTo' in shippingQuote) ? shippingQuote.shipsTo : buyer_country}`,
          shipping: shippingQuote,
        });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet, buyer_country }, { error: 'shipping_rejected', status: shippingQuote.status }, 409, Date.now() - t0);
        return r;
      }

      const shippingUsd = shippingQuote && shippingQuote.status === 'flat_rate'
        ? shippingQuote.costUsd
        : 0;
      const shippingUsdcMinor = Math.round(shippingUsd * 1_000_000);

      // ── Totals ─────────────────────────────────────────────────
      const productUsdcMinor = (product.price_minor as number) * qty;
      const totalUsdcMinor   = productUsdcMinor + shippingUsdcMinor;
      const productUsdc      = productUsdcMinor / 1_000_000;
      const totalUsdc        = totalUsdcMinor / 1_000_000;

      // Normalise the delivery block before persisting. Country uppercased,
      // strings trimmed. For non-physical kinds, delivery stays null.
      const deliveryRow = product.kind === 'physical' && delivery
        ? {
            name:          delivery.name.trim(),
            address_line1: delivery.address_line1.trim(),
            address_line2: delivery.address_line2?.trim() || null,
            city:          delivery.city.trim(),
            region:        delivery.region?.trim() || null,
            postcode:      delivery.postcode.trim(),
            country:       delivery.country.toUpperCase(),
            phone:         delivery.phone.trim(),
          }
        : null;

      // Record the purchase intent — purchase row in 'pending' state. The
      // DB default fires app_generate_order_ref() so we get a short code
      // back to surface to the buyer and seller immediately.
      const { data: purchase, error: intentErr } = await db
        .from('app_purchases')
        .insert({
          product_id:       product.id,
          seller_id:        seller.id,
          buyer_wallet:     buyer_wallet.toLowerCase(),
          buyer_agent_id:   buyer_agent_id ?? null,
          qty,
          total_usdc:       totalUsdc,
          payment_method:   'x402_operator',
          status:           'pending',
          delivery_address: deliveryRow,
          notes:            shippingQuote
            ? `awaiting x402 settlement; product ${productUsdc} + shipping ${shippingUsd} (${shippingQuote.status})`
            : 'awaiting x402 settlement',
        })
        .select('id, order_ref')
        .single();
      if (intentErr || !purchase) {
        console.error('[mcp/buy_product] purchase insert failed', intentErr);
        const r = asJson({ error: 'could not record purchase intent', details: intentErr?.message });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'intent_insert_failed' }, 500, Date.now() - t0);
        return r;
      }

      // x402 payment requirement (USDC on Base mainnet). The buyer's
      // agent pays this and then POSTs to /api/x402/purchase to trigger
      // the on-chain operatorMint + auto-payout. v1.1 wires that endpoint.
      const usdcAddress    = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

      const orderRef = purchase.order_ref as string;
      const out = asJson({
        order_ref:          orderRef,
        purchase_intent_id: purchase.id,
        seller:             seller.slug,
        product:            { id: product.id, title: product.title, token_id: product.token_id, kind: product.kind },
        qty,
        product_usdc:       productUsdc,
        shipping_usdc:      shippingUsd,
        total_usdc:         totalUsdc,
        shipping:           shippingQuote,
        delivery_recorded:  deliveryRow ? { name: deliveryRow.name, city: deliveryRow.city, country: deliveryRow.country } : null,
        seller_acknowledgement: `Order ${orderRef} has been received by ${seller.name} and is pending payment confirmation. Quote this ref in any follow-up.`,
        x402_payment_required: {
          scheme:        'exact',
          network:       'base',
          asset:         usdcAddress,
          maxAmountRequired: String(totalUsdcMinor),
          payTo:         platformWallet,
          description:   shippingQuote && shippingQuote.status === 'flat_rate'
            ? `Order ${orderRef} — ${qty}× ${product.title} from ${seller.name} + shipping to ${shippingQuote.shipsTo}`
            : `Order ${orderRef} — ${qty}× ${product.title} from ${seller.name}`,
          mimeType:      'application/json',
          extra:         { decimals: 6, name: 'USDC' },
        },
        next: {
          settle_endpoint: `${APP_BASE}/api/x402/purchase`,
          method:          'POST',
          body_option_a:   { order_ref: orderRef, x_payment: '<X-PAYMENT header value from signing the x402 permit>' },
          body_option_b:   { order_ref: orderRef, payment_tx_hash: '<hash of a raw USDC transfer of maxAmountRequired to payTo from buyer_wallet>' },
        },
        note: 'Settlement is live at /api/x402/purchase and accepts EITHER an x402 permit (POST x_payment) OR a raw USDC transfer you already sent (POST payment_tx_hash). Both trigger operatorMint + 97.5/2.5 USDC split. For the raw-transfer path the transfer must originate from buyer_wallet and each tx settles only one order. Fulfilment is then handled by the seller; quote the order_ref in any further messages.',
      });
      void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet, buyer_agent_id, buyer_country, has_delivery: !!deliveryRow }, { order_ref: orderRef, purchase_intent_id: purchase.id, total_usdc: totalUsdc, shipping_usdc: shippingUsd, shipping_status: shippingQuote?.status }, 200, Date.now() - t0);
      void insertNotification({
        ownerUserId: seller.owner_user_id,
        kind:        'sale',
        title:       `${orderRef} — needs your fulfilment`,
        body:        `${qty}× ${product.title} · ${totalUsdc.toFixed(2)} USDC · pending x402 settlement${deliveryRow ? ` · ship to ${deliveryRow.city}, ${deliveryRow.country}` : ''}`,
        link:        `/seller/${seller.slug}/admin/orders/${orderRef}`,
        metadata:    {
          tool_name:          'buy_product',
          agent_identity:     identity,
          order_ref:          orderRef,
          purchase_intent_id: purchase.id,
          product_id:         product.id,
          qty,
          total_usdc:         totalUsdc,
          shipping_usdc:      shippingUsd,
          buyer_wallet,
          buyer_agent_id:     buyer_agent_id ?? null,
          buyer_country:      buyer_country ?? null,
          seller_id:          seller.id,
        },
      });
      return out;
    },
  );

  return server;
}

// ── ask_sales_agent backend (delegate to Hermes) ─────────────────────
//
// The buyer-facing Sales Agent runs as a persistent Hermes profile on the
// Box, provisioned per seller via via-agent-wiki/scripts/via-concierges/.
// This route NEVER hits DeepSeek directly — that stateless single-shot
// pattern is the bug the user (correctly) called out. The in-app
// /seller/[slug]/admin/sales-agent training chat keeps its own DeepSeek
// path; that surface is the operator teaching memories. Buyer traffic is
// answered by the persistent agent.
//
// While a seller's hermes_concierge_status is 'pending', the buyer agent
// gets a clear "is being provisioned" reply with a hint to ask again
// shortly. Once 'provisioned', this route proxies the question to the
// seller's hermes_concierge_url with a slug-bound x-concierge-secret.

interface AskSalesAgentResult {
  answer:        string;
  delegated_to:  string | null;   // hermes_concierge_url when proxied, null otherwise
  agent_status:  string;          // pending | provisioned | not_flagged | url_missing
}

async function askSalesAgent(seller: SellerRow, question: string, contact: string | null): Promise<AskSalesAgentResult> {
  const status = (seller.hermes_concierge_status ?? null) as string | null;

  if (status === null) {
    return {
      answer: `${seller.name}'s Sales Agent has not been flagged for provisioning yet. The operator can flip ` +
              `app_sellers.hermes_concierge_status to 'pending' from the superadmin and the queue runner will ` +
              `provision a persistent Sales Agent on the Box. Ask again once it's live.`,
      delegated_to: null,
      agent_status: 'not_flagged',
    };
  }
  if (status === 'pending' || status.startsWith('failed:')) {
    const detail = status.startsWith('failed:') ? ` (last attempt: ${status})` : '';
    return {
      answer: `${seller.name}'s Sales Agent is being provisioned${detail}. Ask again shortly — the operator queue ` +
              `at app.getvia.xyz/api/admin/hermes-concierge drains pending rows and the persistent agent comes ` +
              `online once cutover completes.`,
      delegated_to: null,
      agent_status: status,
    };
  }
  if (status !== 'provisioned') {
    return {
      answer: `${seller.name}'s Sales Agent is in an unknown state (${status}). Operator review needed.`,
      delegated_to: null,
      agent_status: status,
    };
  }

  const conciergeUrl = (seller.hermes_concierge_url ?? '').trim();
  if (!conciergeUrl) {
    return {
      answer: `${seller.name}'s Sales Agent is provisioned but its endpoint is not yet wired into app_sellers.` +
              `hermes_concierge_url. The runner will populate it on next cutover.`,
      delegated_to: null,
      agent_status: 'url_missing',
    };
  }

  // Mint the slug-bound concierge secret here at request time. The root
  // CONCIERGE_KEY_SECRET stays in app.getvia.xyz env only.
  const conciergeKey = conciergeKeyFor(seller.slug);
  if (!conciergeKey) {
    return {
      answer: `Sales Agent delegation is not configured on this deployment (CONCIERGE_KEY_SECRET missing).`,
      delegated_to: null,
      agent_status: 'misconfigured',
    };
  }

  try {
    const res = await fetch(conciergeUrl, {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'Accept':             'application/json',
        'x-concierge-secret': conciergeKey,
      },
      body: JSON.stringify({ question, contact: contact ?? null }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      console.warn(`[mcp/ask_sales_agent] Hermes ${res.status}: ${text}`);
      return {
        answer:       `${seller.name}'s Sales Agent returned an error (${res.status}). Please retry.`,
        delegated_to: conciergeUrl,
        agent_status: 'provisioned',
      };
    }
    const json = await res.json() as { answer?: string };
    return {
      answer:       (json.answer ?? '').trim() || `${seller.name}'s Sales Agent returned an empty response. Please retry.`,
      delegated_to: conciergeUrl,
      agent_status: 'provisioned',
    };
  } catch (err) {
    console.error('[mcp/ask_sales_agent] Hermes fetch threw:', err);
    return {
      answer:       `${seller.name}'s Sales Agent is temporarily unreachable. Please retry shortly.`,
      delegated_to: conciergeUrl,
      agent_status: 'provisioned',
    };
  }
}

// ── HTTP handlers ────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seller = await loadSeller(slug);
  if (!seller) return Response.json({ error: `seller "${slug}" not found or inactive` }, { status: 404 });
  return Response.json({
    name:        `${slug}-sales-agent`,
    version:     '1.0.0',
    description: `Per-seller MCP for ${seller.name}. POST JSON-RPC to this endpoint to interact.`,
    protocol:    'MCP Streamable HTTP',
    seller:      publicSellerInfo(seller),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seller = await loadSeller(slug);
  if (!seller) return Response.json({ error: `seller "${slug}" not found or inactive` }, { status: 404 });

  if (isRateLimited(rateLimitKey(req))) {
    return Response.json({ error: 'rate limit exceeded, slow down' }, { status: 429 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const server = createServer(seller, req);
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
