export const dynamic = 'force-static';

const APP_BASE = 'https://app.getvia.xyz';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

const ACP = {
  protocol: {
    name: 'acp',
    version: '2025-09-29.1',
  },
  api_base_url: APP_BASE,
  transports: ['https', 'mcp'],
  capabilities: {
    services: ['discovery', 'catalogue', 'checkout', 'delegate_payment'],
    supported_currencies: ['USDC'],
    supported_locales: ['en-US'],
  },
  acp: {
    profile: 'https://agenticcommerce.dev',
    version: '2025-09-29.1',
  },
  payment: {
    methods: ['x402', 'usdc-base'],
    token: 'USDC',
    contract: USDC_BASE,
    network: 'base-mainnet',
    recipient: PLATFORM_WALLET,
  },
  identity: {
    standard: 'erc-8004',
    agentId: 38538,
    network: 'base',
    profile: 'https://8004scan.io/agents/base/38538',
  },
  endpoints: {
    discovery_mcp: `${APP_BASE}/mcp`,
    per_seller_mcp: `${APP_BASE}/sellers/{slug}/mcp`,
    settle: `${APP_BASE}/api/x402/purchase`,
  },
  provider: {
    name: 'VIA',
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
};

export function GET() {
  return new Response(JSON.stringify(ACP, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
