export const dynamic = 'force-static';

// Lightweight agent-identity document for crawlers that prefer /agent.json
// over /.well-known/agent-card.json. Same shape as the marketing site's
// /agent.json on getvia.xyz; this is the app subdomain's version, so the
// MCP endpoint points at the per-app surface at app.getvia.xyz/mcp.

const AGENT = {
  name: 'VIA',
  description:
    'VIA Labs sales + buying agent platform. Sellers expose a Sales Agent over MCP at app.getvia.xyz/sellers/[slug]/mcp; buyers train a Buying Agent that negotiates and pays in USDC on Base.',
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  url: 'https://app.getvia.xyz',
  erc8004: {
    agentId: 38538,
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    network: 'base',
    profile: 'https://8004scan.io/agents/base/38538',
  },
  wallet: '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d',
  endpoints: {
    mcp:           'https://app.getvia.xyz/mcp',
    per_seller_mcp:'https://app.getvia.xyz/sellers/{slug}/mcp',
    central_mcp:   'https://www.getvia.xyz/mcp',
    onboard_seller:'https://app.getvia.xyz/onboard?role=seller',
    onboard_buyer: 'https://app.getvia.xyz/onboard?role=buyer',
  },
  payment: {
    token:    'USDC',
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network:  'base-mainnet',
    address:  '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d',
  },
  services: [
    {
      name: 'discovery_mcp',
      endpoint: 'https://app.getvia.xyz/mcp',
      description:
        'VIA app discovery MCP. Tools: list_sellers, find_seller, seller_mcp_url, get_via_overview.',
    },
    {
      name: 'per_seller_mcp',
      endpoint: 'https://app.getvia.xyz/sellers/{slug}/mcp',
      description:
        'Per-seller MCP. Tools: list_products, get_product, get_seller_info, ask_sales_agent, get_shipping_quote, buy_product.',
    },
  ],
  chains: ['base'],
  protocols: ['erc-8004', 'erc-1155', 'mcp', 'a2a', 'x402'],
  agentCard:     'https://app.getvia.xyz/.well-known/agent-card.json',
  mcpServerCard: 'https://app.getvia.xyz/.well-known/mcp/server-card.json',
};

export function GET() {
  return new Response(JSON.stringify(AGENT, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
