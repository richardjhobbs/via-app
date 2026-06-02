/**
 * Per-store MANAGEMENT MCP — app.getvia.xyz/sellers/[slug]/manage/mcp
 *
 * The agent-native, write-enabled counterpart to the public buyer MCP at
 * /sellers/[slug]/mcp. Every request must carry a valid store key in the
 * x-via-store-key header (obtained from POST /api/sellers/[slug]/agent/auth by
 * presenting the store's email + password). The key is hash-verified against
 * app_sellers.agent_api_key_hash, and the store must be live (active=true) with
 * a contact_email on record. No key, no tools.
 *
 * Tools (3):
 *   create_product   — add a draft product (off-chain)
 *   list_my_products — owner view of all products incl. drafts + status
 *   publish_product  — mint a draft on-chain (shared publishProduct path)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { verifyStoreKey } from '@/lib/app/store-keys';
import { publishProduct } from '@/lib/app/publish-product';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

interface ManageSeller {
  id:                 string;
  slug:               string;
  name:               string;
  owner_user_id:      string;
  active:             boolean;
  contact_email:      string | null;
  agent_api_key_hash: string | null;
}

async function loadSeller(slug: string): Promise<ManageSeller | null> {
  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, owner_user_id, active, contact_email, agent_api_key_hash')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as ManageSeller;
}

/**
 * Gate: store must be live, have a human email on record, and present a key
 * that hash-matches. Returns the seller on success, or null to refuse.
 */
function authorise(seller: ManageSeller | null, req: Request): ManageSeller | null {
  if (!seller || !seller.active || !seller.contact_email) return null;
  const presented = req.headers.get('x-via-store-key');
  if (!verifyStoreKey(presented, seller.agent_api_key_hash)) return null;
  return seller;
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function createServer(seller: ManageSeller) {
  const server = new McpServer({ name: `${seller.slug}-store-management`, version: '1.0.0' });

  // ── create_product ───────────────────────────────────────────────
  server.tool(
    'create_product',
    `Add a new product to ${seller.name} as a DRAFT (off-chain). It is not purchasable until you publish_product it. Pricing is in USDC.`,
    {
      kind:        z.enum(['physical', 'digital', 'service']).describe('Product kind. Physical products require buyer delivery details at purchase.'),
      title:       z.string().min(2).max(200),
      price_usdc:  z.number().min(0).describe('Unit price in USDC (e.g. 12.5).'),
      description: z.string().max(4000).optional(),
      stock:       z.number().int().min(0).optional().describe('Available units. Omit for untracked.'),
      max_supply:  z.number().int().min(1).max(10000).optional().describe('On-chain edition ceiling (1-10000). Omit for unlimited.'),
      url:         z.string().url().max(500).optional().describe('Canonical product URL, if any.'),
    },
    async ({ kind, title, price_usdc, description, stock, max_supply, url }) => {
      const priceMinor = Math.round(price_usdc * 1_000_000);
      const { data, error } = await db
        .from('app_seller_products')
        .insert({
          seller_id:   seller.id,
          kind,
          title:       title.trim(),
          description: description ?? null,
          price_minor: priceMinor,
          currency:    'USDC',
          stock:       stock      ?? null,
          max_supply:  max_supply ?? null,
          url:         url        ?? null,
          metadata:    {},
          active:      true,
        })
        .select('id, kind, title, price_minor, currency, stock, max_supply, url, active, on_chain_status')
        .single();
      if (error || !data) return asJson({ ok: false, error: error?.message ?? 'insert failed' });
      return asJson({
        ok:         true,
        product_id: data.id,
        title:      data.title,
        price_usdc: (data.price_minor as number) / 1_000_000,
        kind:       data.kind,
        on_chain_status: data.on_chain_status,
        next: `Draft created. Call publish_product("${data.id}") to mint it on-chain and make it purchasable.`,
      });
    },
  );

  // ── list_my_products ─────────────────────────────────────────────
  server.tool(
    'list_my_products',
    `List ALL of ${seller.name}'s products including drafts, with on-chain status. Use this to find product_ids to publish.`,
    {
      limit: z.number().int().min(1).max(200).optional().describe('Max products (default 100).'),
    },
    async ({ limit }) => {
      const max = Math.min(Math.max(limit ?? 100, 1), 200);
      const { data, error } = await db
        .from('app_seller_products')
        .select('id, kind, title, price_minor, currency, stock, max_supply, active, on_chain_status, token_id, created_at')
        .eq('seller_id', seller.id)
        .order('created_at', { ascending: false })
        .limit(max);
      if (error) return asJson({ ok: false, error: error.message });
      const products = (data ?? []).map((p) => ({
        product_id:      p.id,
        title:           p.title,
        kind:            p.kind,
        price_usdc:      (p.price_minor as number) / 1_000_000,
        stock:           p.stock,
        max_supply:      p.max_supply,
        active:          p.active,
        on_chain_status: p.on_chain_status,
        token_id:        p.token_id,
        purchasable:     p.on_chain_status === 'registered' && p.active,
      }));
      return asJson({ ok: true, count: products.length, products });
    },
  );

  // ── publish_product ──────────────────────────────────────────────
  server.tool(
    'publish_product',
    `Mint one of ${seller.name}'s draft products on-chain so buying agents can purchase it. Pass the product_id from create_product / list_my_products. Irreversible: it claims a global token_id and fires registerDrop on Base. The flat 2.5% network fee applies to sales; you keep 97.5%.`,
    {
      product_id: z.string().uuid().describe('UUID of a draft product to publish.'),
    },
    async ({ product_id }) => {
      const result = await publishProduct(seller.id, product_id, seller.owner_user_id);
      if (!result.ok) {
        return asJson({ ok: false, error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.extra ?? {}) });
      }
      return asJson({
        ok:            true,
        product_id,
        token_id:      result.token_id,
        tx_hash:       result.tx_hash,
        chain_skipped: result.chain_skipped,
        message:       `Published. The product is now live on ${APP_BASE}/sellers/${seller.slug}/mcp and discoverable by buying agents.`,
      });
    },
  );

  return server;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seller = await loadSeller(slug);
  if (!seller) return Response.json({ error: `store "${slug}" not found` }, { status: 404 });
  return Response.json({
    name:        `${slug}-store-management`,
    version:     '1.0.0',
    description: `Store management MCP for ${seller.name}. Requires the x-via-store-key header (POST /api/sellers/${slug}/agent/auth to obtain it). POST JSON-RPC to interact.`,
    protocol:    'MCP Streamable HTTP',
    auth:        'x-via-store-key header',
    obtain_key:  `${APP_BASE}/api/sellers/${slug}/agent/auth`,
    tools:       ['create_product', 'list_my_products', 'publish_product'],
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seller = authorise(await loadSeller(slug), req);
  if (!seller) {
    return Response.json(
      { error: 'unauthorised: a valid x-via-store-key for a live store is required. Obtain one at POST /api/sellers/' + slug + '/agent/auth.' },
      { status: 401 },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer(seller);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, x-via-store-key',
    },
  });
}
