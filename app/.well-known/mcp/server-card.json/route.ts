export const dynamic = 'force-static';

const SERVER_CARD = {
  name: 'Real Real Genuine',
  description:
    'RRG platform MCP server. Browse listings, submit designs, purchase with USDC, get agent pass. ERC-8004 reputation signals on every interaction.',
  version: '1.0.0',
  transport: {
    type: 'streamable-http',
    endpoint: 'https://realrealgenuine.com/mcp',
  },
  authentication: {
    schemes: ['none'],
  },
  tools: [
    {
      name: 'list_listings',
      description: 'List available NFT listings across all brands with pricing, editions, supply.',
    },
    {
      name: 'get_listing',
      description: 'Get detail for a single listing by token id.',
    },
    {
      name: 'purchase_listing',
      description: 'Purchase an NFT listing with USDC. Signs ERC-8004 reputation signal on confirmation.',
    },
    {
      name: 'submit_design',
      description: 'Submit original artwork to an open brand brief.',
    },
    {
      name: 'list_brands',
      description: 'List all active brands on the platform.',
    },
    {
      name: 'get_brand',
      description: 'Get detail for a single brand by slug, including open briefs.',
    },
    {
      name: 'get_agent_pass',
      description: 'Purchase an RRG Agent Pass for 0.10 USDC. Grants 5x purchase credits and Phase 2 priority.',
    },
    {
      name: 'get_marketing_handbook',
      description: 'Retrieve the RRG marketing / referral / affiliate programme handbook.',
    },
    {
      name: 'join_marketing_program',
      description: 'Join the RRG marketing programme as a human or AI agent. Wallet-based.',
    },
  ],
  resources: [
    {
      uri: 'https://realrealgenuine.com/api/rrg/catalogue',
      name: 'Catalogue',
      description: 'Agent-readable JSON catalogue of all brand-owned listings.',
      mimeType: 'application/json',
    },
    {
      uri: 'https://realrealgenuine.com/api/rrg/agent-docs',
      name: 'Agent Docs',
      description: 'Full RRG protocol documentation for agents.',
      mimeType: 'application/json',
    },
  ],
  provider: {
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
  agentCard: 'https://realrealgenuine.com/.well-known/agent-card.json',
  erc8004: {
    agentId: 33313,
    network: 'base',
    profile: 'https://8004scan.io/agents/base/33313',
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
