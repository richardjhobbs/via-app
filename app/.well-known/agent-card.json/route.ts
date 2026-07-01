export const dynamic = 'force-static';

// A2A agent-card discovery for app.getvia.xyz. The card describes the
// central VIA app surface; per-seller agents are reached via
// list_sellers → sellers/[slug]/mcp.

const APP_BASE = 'https://app.getvia.xyz';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

const CARD = {
  name: 'VIA',
  description:
    'VIA Labs sales + buying agent platform. Any seller exposes a Sales Agent over MCP at app.getvia.xyz/sellers/[slug]/mcp; any buyer trains a Buying Agent that negotiates and pays in USDC on Base. Discovery + cross-seller search at app.getvia.xyz/mcp.',
  url: `${APP_BASE}/mcp`,
  version: '1.0.0',
  preferredTransport: 'JSONRPC',
  extensions: [
    {
      uri: 'https://github.com/google-agentic-commerce/AP2',
      name: 'ap2',
      description:
        'AP2 (Agent Payments Protocol). Sellers settle in USDC on Base; buyers pay via x402.',
      required: false,
      params: {
        methods: ['x402', 'usdc-base'],
        networks: ['base-mainnet'],
        recipient: PLATFORM_WALLET,
      },
    },
    {
      uri: 'https://x402.org',
      name: 'x402',
      description:
        'x402 HTTP payment extension. buy_product on a per-seller MCP returns HTTP 402 with payment requirements; settlement at /api/x402/purchase.',
      required: false,
      params: {
        networks: ['base-mainnet'],
        recipient: PLATFORM_WALLET,
        asset: USDC_BASE,
      },
    },
  ],
  supportedInterfaces: [
    {
      transport: 'JSONRPC',
      url: `${APP_BASE}/mcp`,
      description: 'Central discovery MCP — list_sellers, find_seller, seller_mcp_url, get_via_overview.',
    },
    {
      transport: 'JSONRPC',
      url: `${APP_BASE}/sellers/{slug}/mcp`,
      description: 'Per-seller MCP — list_products, get_product, get_seller_info, ask_sales_agent, buy_product. Resolve {slug} via list_sellers above.',
    },
  ],
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  skills: [
    {
      id: 'list-sellers',
      name: 'List sellers',
      description: 'Browse the active VIA seller index, optionally filtered by kind (product/service/mixed). Returns per-seller MCP URLs for follow-up.',
    },
    {
      id: 'find-seller',
      name: 'Find seller',
      description: 'Free-text search across active sellers by name, description, or headline.',
    },
    {
      id: 'list-products',
      name: 'List products',
      description: 'On a per-seller MCP, list active on-chain-registered ERC-1155 listings. Each row carries tokenId for buy_product follow-up.',
    },
    {
      id: 'ask-sales-agent',
      name: 'Ask Sales Agent',
      description: 'On a per-seller MCP, ask a free-form question. The seller-trained DeepSeek agent answers using its locked-in memories (policies, stock, promotions).',
    },
    {
      id: 'buy-product',
      name: 'Buy product',
      description: 'On a per-seller MCP, initiate a purchase. Returns an x402 payment requirement (USDC on Base) and a purchase_intent_id. Pay it, then POST to /api/x402/purchase to trigger operatorMint + 97.5/2.5 USDC payout.',
    },
  ],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  provider: {
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
  authentication: {
    schemes: ['none', 'wallet_signature'],
  },
  commerce: {
    ap2: {
      supported: true,
      profile: 'https://a2a-protocol.org/latest/specification/payment/',
      methods: ['x402', 'usdc-base'],
    },
    x402: {
      supported: true,
      profile: 'https://x402.org',
      networks: ['base-mainnet'],
      recipient: PLATFORM_WALLET,
      token: {
        symbol: 'USDC',
        contract: USDC_BASE,
      },
    },
    ucp: `${APP_BASE}/.well-known/ucp`,
    acp: `${APP_BASE}/.well-known/acp.json`,
    api_catalog: `${APP_BASE}/.well-known/api-catalog`,
  },
  paymentMethods: ['x402', 'ap2', 'usdc-base'],
};

export function GET() {
  return new Response(JSON.stringify(CARD, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
