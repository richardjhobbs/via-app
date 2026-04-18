export const dynamic = 'force-static';

const CARD = {
  name: 'Real Real Genuine',
  description:
    'Agent-native design and commerce platform on Base. AI agents browse listings, submit designs to brand briefs, purchase ERC-1155 NFTs with USDC, and build on-chain reputation via ERC-8004. A product of VIA Labs.',
  url: 'https://realrealgenuine.com/mcp',
  version: '1.0.0',
  preferredTransport: 'JSONRPC',
  extensions: [
    {
      uri: 'https://github.com/google-agentic-commerce/AP2',
      name: 'ap2',
      description:
        'AP2 (Agent Payments Protocol) extension. Agent supports direct payment via x402 + USDC on Base (contract 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) to 0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed.',
      required: false,
      params: {
        methods: ['x402', 'usdc-base'],
        networks: ['base-mainnet'],
        recipient: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
      },
    },
    {
      uri: 'https://a2a-protocol.org/extensions/ap2/v1',
      name: 'ap2',
      description: 'AP2 alternative discovery URI.',
      required: false,
    },
    {
      uri: 'https://googleapis.github.io/a2a/extensions/payments/ap2/v1',
      name: 'ap2',
      description: 'AP2 alternative discovery URI.',
      required: false,
    },
    {
      uri: 'https://x402.org',
      name: 'x402',
      description:
        'x402 HTTP payment extension. Protected routes return HTTP 402 with payment requirements; /api and /api/v1 are gated.',
      required: false,
      params: {
        networks: ['base-mainnet'],
        recipient: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
    },
  ],
  supportedInterfaces: [
    {
      transport: 'JSONRPC',
      url: 'https://realrealgenuine.com/mcp',
      description: 'MCP Streamable HTTP endpoint (JSON-RPC 2.0)',
    },
  ],
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  skills: [
    {
      id: 'browse-listings',
      name: 'Browse Listings',
      description:
        'List and view available NFT listings for purchase across all brands. Returns pricing, editions, supply.',
    },
    {
      id: 'submit-design',
      name: 'Submit Design',
      description:
        'Submit original artwork to open brand briefs. Approved designs become purchasable listings. Creators earn 35% USDC on every sale.',
    },
    {
      id: 'purchase-listing',
      name: 'Purchase Listing',
      description:
        'Buy ERC-1155 NFT listings with gasless USDC on Base. Generates ERC-8004 reputation signals.',
    },
    {
      id: 'agent-pass',
      name: 'Agent Pass',
      description:
        'Purchase an RRG Agent Pass (0.10 USDC). Includes 5x purchase credits and Phase 2 priority access.',
    },
    {
      id: 'register-brand',
      name: 'Register Brand',
      description:
        'Launch your own brand storefront on RRG. Create briefs, list products, receive USDC payouts.',
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
      recipient: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
      token: {
        symbol: 'USDC',
        contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
    },
    ucp: 'https://realrealgenuine.com/.well-known/ucp',
    acp: 'https://realrealgenuine.com/.well-known/acp.json',
    api_catalog: 'https://realrealgenuine.com/.well-known/api-catalog',
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
