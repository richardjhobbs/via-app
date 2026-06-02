/**
 * Per-store MANAGEMENT MCP — app.getvia.xyz/sellers/[slug]/manage/mcp
 *
 * The agent-native, write-enabled counterpart to the public buyer MCP at
 * /sellers/[slug]/mcp. Fully MCP-native: an owning agent authenticates by
 * SIGNING a challenge with the store's agent wallet (app_sellers.
 * agent_wallet_address, the ERC-8004 holder) over MCP tool calls, by URL, with
 * no custom header and no password.
 *
 * Flow:
 *   1. get_challenge({ wallet })            -> a message to sign + a challenge token
 *   2. authenticate({ wallet, challenge, signature })
 *                                           -> session_token (a store key)
 *   3. create_product / list_my_products / publish_product({ session_token, ... })
 *
 * The store must be live (active=true) with a contact_email on record; pending
 * or rejected stores cannot authenticate. For backward compatibility a valid
 * x-via-store-key header is also accepted on the management tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { generateStoreKey, hashStoreKey, verifyStoreKey } from '@/lib/app/store-keys';
import { issueChallenge, verifyChallenge } from '@/lib/app/store-auth';
import { publishProduct } from '@/lib/app/publish-product';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

interface ManageSeller {
  id:                   string;
  slug:                 string;
  name:                 string;
  owner_user_id:        string;
  active:               boolean;
  contact_email:        string | null;
  agent_wallet_address: string | null;
  agent_api_key_hash:   string | null;
}

async function loadSeller(slug: string): Promise<ManageSeller | null> {
  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, owner_user_id, active, contact_email, agent_wallet_address, agent_api_key_hash')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as ManageSeller;
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function liveWithEmail(seller: ManageSeller): boolean {
  return seller.active === true && !!seller.contact_email;
}

function createServer(seller: ManageSeller, req: Request) {
  const server = new McpServer({ name: `${seller.slug}-store-management`, version: '1.0.0' }, {
    instructions:
      `Store management MCP for ${seller.name}. To manage the catalogue you must authenticate by proving control of the store's agent wallet: ` +
      `1) get_challenge({ wallet }) returns a message to sign; 2) sign that message with the agent wallet; 3) authenticate({ wallet, challenge, signature }) returns a session_token. ` +
      `Then call create_product, list_my_products, and publish_product passing that session_token. Only the agent wallet on record can authenticate.`,
  });

  // Resolve management auth: a session_token tool arg (preferred) or a legacy
  // x-via-store-key header. Both are store keys hash-checked against the row.
  function authed(sessionToken?: string): boolean {
    if (!liveWithEmail(seller)) return false;
    if (sessionToken && verifyStoreKey(sessionToken, seller.agent_api_key_hash)) return true;
    const header = req.headers.get('x-via-store-key');
    return verifyStoreKey(header, seller.agent_api_key_hash);
  }

  const unauthed = () => asJson({
    ok: false,
    error: 'not_authenticated',
    message: `Provide a session_token. Get one by calling get_challenge({ wallet }) with this store's agent wallet, signing the returned message with that wallet, then authenticate({ wallet, challenge, signature }).`,
  });

  // ── get_challenge ────────────────────────────────────────────────
  server.tool(
    'get_challenge',
    `Begin agent-native authentication for ${seller.name}. Pass the store's agent wallet (see get_seller_info.agent_wallet on the public MCP). Returns a message to sign with that wallet and a challenge token. Only the wallet on record for this store can manage it.`,
    {
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid EVM address').describe("The store's agent wallet address (ERC-8004 holder)."),
    },
    async ({ wallet }) => {
      if (!liveWithEmail(seller)) {
        return asJson({ ok: false, error: 'store_not_live', message: 'This store is not authorised for management (must be approved/active with a contact email).' });
      }
      if (!seller.agent_wallet_address || wallet.toLowerCase() !== seller.agent_wallet_address.toLowerCase()) {
        return asJson({ ok: false, error: 'wallet_not_authorised', message: 'That wallet is not the agent wallet on record for this store.' });
      }
      const challenge = issueChallenge(seller.slug, wallet);
      if (!challenge) return asJson({ ok: false, error: 'not_configured', message: 'Store auth is not configured on the server.' });
      return asJson({
        ok:         true,
        message:    challenge.message,
        challenge:  challenge.challenge,
        expires_at: challenge.expires_at,
        next:       'Sign `message` with the agent wallet, then call authenticate({ wallet, challenge, signature }).',
      });
    },
  );

  // ── authenticate ─────────────────────────────────────────────────
  server.tool(
    'authenticate',
    `Complete agent-native authentication for ${seller.name}. Pass the wallet, the challenge token from get_challenge, and the signature of the challenge message. Returns a session_token to pass to the management tools.`,
    {
      wallet:    z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid EVM address'),
      challenge: z.string().min(8).describe('The challenge token returned by get_challenge.'),
      signature: z.string().min(8).describe('Signature of the challenge message, signed by the agent wallet.'),
    },
    async ({ wallet, challenge, signature }) => {
      if (!liveWithEmail(seller)) {
        return asJson({ ok: false, error: 'store_not_live' });
      }
      if (!seller.agent_wallet_address || wallet.toLowerCase() !== seller.agent_wallet_address.toLowerCase()) {
        return asJson({ ok: false, error: 'wallet_not_authorised' });
      }
      const result = verifyChallenge(seller.slug, wallet, challenge, signature);
      if (!result.ok) {
        return asJson({ ok: false, error: 'auth_failed', reason: result.reason, message: 'Signature or challenge did not verify. Start again with get_challenge.' });
      }
      const sessionToken = generateStoreKey();
      const { error } = await db
        .from('app_sellers')
        .update({ agent_api_key_hash: hashStoreKey(sessionToken), updated_at: new Date().toISOString() })
        .eq('id', seller.id);
      if (error) {
        console.error('[manage/authenticate] key persist failed', error);
        return asJson({ ok: false, error: 'could not issue a session, retry shortly' });
      }
      // Keep the in-memory copy current so a subsequent tool call in the same
      // session authenticates without a round trip.
      seller.agent_api_key_hash = hashStoreKey(sessionToken);
      return asJson({
        ok:            true,
        session_token: sessionToken,
        note:          'Pass session_token to create_product, list_my_products, and publish_product. It rotates on each authenticate.',
      });
    },
  );

  // ── create_product ───────────────────────────────────────────────
  server.tool(
    'create_product',
    `Add a new product to ${seller.name} as a DRAFT (off-chain). Requires a session_token from authenticate. Not purchasable until you publish_product it. Pricing is in USDC.`,
    {
      session_token: z.string().optional().describe('From authenticate (or send the x-via-store-key header).'),
      kind:          z.enum(['physical', 'digital', 'service']),
      title:         z.string().min(2).max(200),
      price_usdc:    z.number().min(0).describe('Unit price in USDC (e.g. 7.83).'),
      description:   z.string().max(4000).optional(),
      stock:         z.number().int().min(0).optional(),
      max_supply:    z.number().int().min(1).max(10000).optional().describe('On-chain edition ceiling (1-10000). Omit for unlimited.'),
      url:           z.string().url().max(500).optional(),
    },
    async ({ session_token, kind, title, price_usdc, description, stock, max_supply, url }) => {
      if (!authed(session_token)) return unauthed();
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
        .select('id, kind, title, price_minor, on_chain_status')
        .single();
      if (error || !data) return asJson({ ok: false, error: error?.message ?? 'insert failed' });
      return asJson({
        ok:              true,
        product_id:      data.id,
        title:           data.title,
        price_usdc:      (data.price_minor as number) / 1_000_000,
        kind:            data.kind,
        on_chain_status: data.on_chain_status,
        next:            `Draft created. Call publish_product({ session_token, product_id: "${data.id}" }) to mint it on-chain and make it purchasable.`,
      });
    },
  );

  // ── list_my_products ─────────────────────────────────────────────
  server.tool(
    'list_my_products',
    `List ALL of ${seller.name}'s products including drafts, with on-chain status. Requires a session_token. Use it to find product_ids to publish.`,
    {
      session_token: z.string().optional(),
      limit:         z.number().int().min(1).max(200).optional(),
    },
    async ({ session_token, limit }) => {
      if (!authed(session_token)) return unauthed();
      const max = Math.min(Math.max(limit ?? 100, 1), 200);
      const { data, error } = await db
        .from('app_seller_products')
        .select('id, kind, title, price_minor, stock, max_supply, active, on_chain_status, token_id, created_at')
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
    `Mint one of ${seller.name}'s draft products on-chain so buying agents can purchase it. Requires a session_token. Irreversible: claims a global token_id and fires registerDrop on Base. The flat 2.5% network fee applies to sales; you keep 97.5%.`,
    {
      session_token: z.string().optional(),
      product_id:    z.string().uuid(),
    },
    async ({ session_token, product_id }) => {
      if (!authed(session_token)) return unauthed();
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
    description: `Store management MCP for ${seller.name}. Authenticate by signing a challenge with the store's agent wallet: get_challenge -> sign -> authenticate -> session_token. POST JSON-RPC to interact.`,
    protocol:    'MCP Streamable HTTP',
    auth:        'wallet-signature (get_challenge / authenticate)',
    tools:       ['get_challenge', 'authenticate', 'create_product', 'list_my_products', 'publish_product'],
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seller = await loadSeller(slug);
  if (!seller) return Response.json({ error: `store "${slug}" not found` }, { status: 404 });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, x-via-store-key',
    },
  });
}
