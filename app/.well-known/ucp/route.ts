export const dynamic = 'force-static';

const APP_BASE = 'https://app.getvia.xyz';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

const UCP = {
  ucp: {
    profile: 'https://ucp.dev/specification/overview/',
    version: '1.0',
  },
  protocol_version: '1.0',
  services: ['commerce', 'digital-goods', 'physical-goods', 'services'],
  capabilities: {
    payments: {
      methods: ['usdc-base', 'x402'],
      currencies: ['USDC'],
      networks: ['base-mainnet'],
    },
    catalog: {
      discovery: `${APP_BASE}/mcp`,
      mimeTypes: ['application/json'],
    },
    fulfilment: {
      digital: true,
      physical: true,
      services: true,
      shipping: 'seller-configured',
    },
    provenance: {
      standard: 'erc-8004',
      network: 'base',
      agentId: 38538,
    },
  },
  endpoints: {
    mcp: `${APP_BASE}/mcp`,
    per_seller_mcp: `${APP_BASE}/sellers/{slug}/mcp`,
    agent_card: `${APP_BASE}/.well-known/agent-card.json`,
    mcp_server_card: `${APP_BASE}/.well-known/mcp/server-card.json`,
    api_catalog: `${APP_BASE}/.well-known/api-catalog`,
    settle: `${APP_BASE}/api/x402/purchase`,
  },
  payment: {
    token: 'USDC',
    contract: USDC_BASE,
    network: 'base-mainnet',
    recipient: PLATFORM_WALLET,
  },
  provider: {
    name: 'VIA',
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
