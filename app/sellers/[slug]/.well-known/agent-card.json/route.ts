import { db } from '@/lib/app/db';

// Per-seller A2A agent card. Generated live from the app_sellers row so a
// seller's ERC-8004 registration (erc8004_agent_id, minted per seller by the
// getvia.xyz registrar) is always reflected here, and a newly-minted identity
// appears automatically with no manual edit. Discoverable alongside the
// seller's MCP at /sellers/[slug]/mcp.
export const dynamic = 'force-dynamic';

const APP_BASE = 'https://app.getvia.xyz';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';
const ERC8004_IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const ERC8004_REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const { data: s } = await db
    .from('app_sellers')
    .select('slug, name, kind, headline, description, website_url, agent_wallet_address, erc8004_agent_id, active')
    .eq('slug', slug)
    .maybeSingle();

  if (!s || !s.active) {
    return new Response(JSON.stringify({ error: 'seller not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const mcpUrl = `${APP_BASE}/sellers/${s.slug}/mcp`;
  const agentId = s.erc8004_agent_id as string | null;

  const identity = agentId
    ? {
        standard: 'ERC-8004',
        spec: 'https://eips.ethereum.org/EIPS/eip-8004',
        network: 'base-mainnet',
        identityRegistry: ERC8004_IDENTITY_REGISTRY,
        reputationRegistry: ERC8004_REPUTATION_REGISTRY,
        agentId,
        agentWallet: s.agent_wallet_address,
        verify: `https://8004scan.io/agents/base/${agentId}`,
        description: `${s.name}'s Sales Agent holds ERC-8004 identity #${agentId} on Base, minted by the getvia.xyz registrar. Verify ownership on-chain before transacting.`,
      }
    : {
        standard: 'ERC-8004',
        network: 'base-mainnet',
        identityRegistry: ERC8004_IDENTITY_REGISTRY,
        status: 'unregistered',
        description: 'This store does not yet hold an ERC-8004 identity.',
      };

  const card = {
    name: s.name,
    description: s.headline || s.description || `${s.name} on VIA. Sales Agent over MCP, settling in USDC on Base.`,
    url: mcpUrl,
    version: '1.0.0',
    preferredTransport: 'JSONRPC',
    provider: { organization: 'VIA Labs', url: 'https://www.getvia.xyz' },
    supportedInterfaces: [
      {
        transport: 'JSONRPC',
        url: mcpUrl,
        description: 'Per-seller MCP: list_products, get_product, get_seller_info, get_shipping_quote, ask_sales_agent, buy_product.',
      },
    ],
    extensions: [
      {
        uri: 'https://x402.org',
        name: 'x402',
        description: 'x402 HTTP payment extension. buy_product returns HTTP 402 with USDC payment requirements; settlement at /api/x402/purchase.',
        required: false,
        params: { networks: ['base-mainnet'], recipient: PLATFORM_WALLET, asset: USDC_BASE },
      },
      {
        uri: 'https://eips.ethereum.org/EIPS/eip-8004',
        name: 'erc-8004',
        description: 'ERC-8004 Trustless Agents. This Sales Agent holds an on-chain identity in the Base Identity Registry.',
        required: false,
        params: {
          networks: ['base-mainnet'],
          identityRegistry: ERC8004_IDENTITY_REGISTRY,
          reputationRegistry: ERC8004_REPUTATION_REGISTRY,
          registrar: 'https://www.getvia.xyz/mcp',
          ...(agentId ? { agentId, agentWallet: s.agent_wallet_address } : {}),
        },
      },
    ],
    identity,
    capabilities: { streaming: false, pushNotifications: false },
    authentication: { schemes: ['none', 'wallet_signature'] },
    paymentMethods: ['x402', 'usdc-base'],
  };

  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short cache so a freshly-minted identity shows within a minute.
      'cache-control': 'public, max-age=60',
    },
  });
}
