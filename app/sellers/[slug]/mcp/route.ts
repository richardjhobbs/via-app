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
}

async function loadSeller(slug: string): Promise<SellerRow | null> {
  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, headline, description, website_url, contact_email, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, active')
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
        .select('id, title, description, kind, price_minor, currency, stock, url, image_url, token_id, on_chain_status, max_supply')
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
        image_url:     p.image_url,
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
        .select('id, title, description, kind, price_minor, currency, stock, url, image_url, token_id, on_chain_status, max_supply, metadata')
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
        image_url:     data.image_url,
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
    `Ask ${seller.name}'s Sales Agent a question. The agent answers in the seller's voice using its locked-in memories (events, promotions, policies, stock notes).`,
    {
      question: z.string().min(1).max(2000).describe('Free-form buyer question'),
    },
    async ({ question }) => {
      const t0 = Date.now();
      const reply = await askSalesAgent(seller, question);
      const out = asJson({ seller: seller.slug, question, answer: reply });
      void logInteraction(seller.id, 'ask_sales_agent', identity, { question: question.slice(0, 200) }, { len: reply.length }, 200, Date.now() - t0);
      return out;
    },
  );

  // ── buy_product (v1 — returns x402 payment requirement) ─────────
  server.tool(
    'buy_product',
    `Initiate a purchase of one of ${seller.name}'s listings. Returns an x402 payment requirement (USDC on Base) plus a purchase_intent_id. Pay the requirement, then POST to /api/x402/purchase with the intent ID to trigger operatorMint + 97.5/2.5 USDC payout.`,
    {
      product_id:     z.string().uuid(),
      qty:            z.number().int().min(1).max(1000).default(1),
      buyer_wallet:   z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid Base wallet address'),
      buyer_agent_id: z.string().optional().describe('ERC-8004 agent ID of the Buying Agent acting on the buyer\'s behalf'),
    },
    async ({ product_id, qty, buyer_wallet, buyer_agent_id }) => {
      const t0 = Date.now();

      const { data: product, error: prodErr } = await db
        .from('app_seller_products')
        .select('id, title, price_minor, currency, stock, token_id, on_chain_status, active, max_supply')
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

      if (!ethers.isAddress(buyer_wallet)) {
        const r = asJson({ error: 'buyer_wallet is not a valid EVM address' });
        void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet }, { error: 'invalid_buyer_wallet' }, 400, Date.now() - t0);
        return r;
      }

      const priceUsdcMinor = (product.price_minor as number) * qty; // 6-decimal USDC
      const priceUsdc      = priceUsdcMinor / 1_000_000;

      // Record the purchase intent — purchase row in 'pending' state.
      const { data: purchase, error: intentErr } = await db
        .from('app_purchases')
        .insert({
          product_id:     product.id,
          seller_id:      seller.id,
          buyer_wallet:   buyer_wallet.toLowerCase(),
          buyer_agent_id: buyer_agent_id ?? null,
          qty,
          total_usdc:     priceUsdc,
          payment_method: 'x402_operator',
          status:         'pending',
          notes:          'awaiting x402 settlement',
        })
        .select('id')
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
      const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d';

      const out = asJson({
        purchase_intent_id: purchase.id,
        seller:             seller.slug,
        product:            { id: product.id, title: product.title, token_id: product.token_id },
        qty,
        total_usdc:         priceUsdc,
        x402_payment_required: {
          scheme:        'exact',
          network:       'base',
          asset:         usdcAddress,
          maxAmountRequired: String(priceUsdcMinor),
          payTo:         platformWallet,
          description:   `Purchase ${qty}× ${product.title} from ${seller.name}`,
          mimeType:      'application/json',
          extra:         { decimals: 6, name: 'USDC' },
        },
        next: {
          settle_endpoint: `${APP_BASE}/api/x402/purchase`,
          method:          'POST',
          body:            { purchase_intent_id: purchase.id, x_payment: '<X-PAYMENT header value from the x402 exchange>' },
        },
        note: 'v1: settlement endpoint at /api/x402/purchase is being wired next. Pay the requirement and we will fire operatorMint + 97.5/2.5 USDC split.',
      });
      void logInteraction(seller.id, 'buy_product', identity, { product_id, qty, buyer_wallet, buyer_agent_id }, { purchase_intent_id: purchase.id, total_usdc: priceUsdc }, 200, Date.now() - t0);
      return out;
    },
  );

  return server;
}

// ── ask_sales_agent backend (lightweight DeepSeek call) ─────────────

async function askSalesAgent(seller: SellerRow, question: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return `[${seller.name}'s Sales Agent is being trained — DEEPSEEK_API_KEY not yet provisioned on this deployment.]`;
  }

  // Load active memories for context. Use the migration's RPC.
  const { data: memories } = await db.rpc('app_seller_memory_list', {
    p_slug:            seller.slug,
    p_type:            null,
    p_tag:             null,
    p_include_expired: false,
    p_limit:           20,
  });
  const memBlock = Array.isArray(memories) && memories.length > 0
    ? memories.map((m: { title: string; body: string; type: string }) => `[${m.type}] ${m.title}: ${m.body}`).join('\n')
    : '(no memories yet — answer based on the seller\'s name + description only)';

  const systemPrompt = `You are the Sales Agent for ${seller.name}.

Public profile:
- Kind: ${seller.kind}
- Headline: ${seller.headline ?? '(none)'}
- Description: ${seller.description ?? '(none)'}
- Website: ${seller.website_url ?? '(none)'}

Locked-in memories (your source of truth):
${memBlock}

You are speaking to a buying agent (representing a human buyer) over MCP. Be concise, factual, and warm. If you do not know something from the seller's profile or memories, say so explicitly rather than inventing. End every reply with a clear next-step suggestion (browse list_products, ask a follow-up, or call buy_product).`;

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: question },
        ],
        temperature: 0.4,
        max_tokens:  600,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[mcp/ask_sales_agent] DeepSeek ${res.status}: ${text.slice(0, 200)}`);
      return `[Sales Agent transient error — please retry.]`;
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? '[empty response]';
  } catch (err) {
    console.error('[mcp/ask_sales_agent] fetch threw:', err);
    return `[Sales Agent unreachable — please retry shortly.]`;
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
