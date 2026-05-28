export const dynamic = 'force-static';

const APP_BASE = 'https://app.getvia.xyz';

const SERVER_CARD = {
  name: 'VIA',
  description:
    'VIA Labs central discovery MCP. Use list_sellers / find_seller / seller_mcp_url to find a seller, then connect to that seller\'s per-seller MCP for list_products, ask_sales_agent, buy_product.',
  version: '1.0.0',
  transport: {
    type: 'streamable-http',
    endpoint: `${APP_BASE}/mcp`,
  },
  authentication: {
    schemes: ['none'],
  },
  tools: [
    {
      name: 'list_sellers',
      description: 'Active VIA seller index. Optional category filter (product/service/mixed). Each result includes the per-seller MCP URL.',
    },
    {
      name: 'find_seller',
      description: 'Free-text search across active sellers (name, description, headline).',
    },
    {
      name: 'seller_mcp_url',
      description: 'Resolve a slug to its per-seller MCP URL, verified against the active seller index.',
    },
    {
      name: 'get_via_overview',
      description: 'Short overview of VIA Labs and the entrypoint URLs for buyers and sellers.',
    },
  ],
  per_seller_mcp_tools: [
    {
      name: 'list_products',
      description: 'Active on-chain-registered ERC-1155 listings for one seller. Returns title, price (USDC), stock, tokenId.',
    },
    {
      name: 'get_product',
      description: 'Single listing by product_id, with on-chain stock.',
    },
    {
      name: 'get_seller_info',
      description: 'Public seller card — name, kind, description, ERC-8004 IDs, agent wallet.',
    },
    {
      name: 'ask_sales_agent',
      description: 'Free-form question to the seller\'s DeepSeek-backed Sales Agent. Answers using locked-in memories.',
    },
    {
      name: 'buy_product',
      description: 'Initiate a purchase. Returns x402 payment requirement (USDC on Base) + purchase_intent_id. Settle at /api/x402/purchase.',
    },
  ],
  provider: {
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
  agentCard: `${APP_BASE}/.well-known/agent-card.json`,
  erc8004: {
    agentId: 38538,
    network: 'base',
    profile: 'https://8004scan.io/agents/base/38538',
  },
};

export function GET() {
  return new Response(JSON.stringify(SERVER_CARD, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
