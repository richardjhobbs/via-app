export const dynamic = 'force-static';

const UCP = {
  ucp: {
    profile: 'https://ucp.dev/specification/overview/',
    version: '1.0',
  },
  protocol_version: '1.0',
  services: ['commerce', 'digital-goods', 'physical-goods', 'nft-marketplace'],
  capabilities: {
    payments: {
      methods: ['usdc-base', 'x402'],
      currencies: ['USDC'],
      networks: ['base-mainnet'],
    },
    catalog: {
      discovery: 'https://realrealgenuine.com/api/rrg/catalogue',
      mimeTypes: ['application/json'],
    },
    fulfilment: {
      digital: true,
      physical: true,
      shipping: 'merchant-configured',
    },
    provenance: {
      standard: 'erc-8004',
      network: 'base',
      agentId: 33313,
    },
  },
  endpoints: {
    mcp: 'https://realrealgenuine.com/mcp',
    catalogue: 'https://realrealgenuine.com/api/rrg/catalogue',
    agent_docs: 'https://realrealgenuine.com/api/rrg/agent-docs',
    agent_card: 'https://realrealgenuine.com/.well-known/agent-card.json',
    mcp_server_card: 'https://realrealgenuine.com/.well-known/mcp/server-card.json',
    api_catalog: 'https://realrealgenuine.com/.well-known/api-catalog',
  },
  payment: {
    token: 'USDC',
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'base-mainnet',
    recipient: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
  },
  provider: {
    name: 'Real Real Genuine',
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
};

export function GET() {
  return new Response(JSON.stringify(UCP, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
