export const dynamic = 'force-static';

const ACP = {
  protocol: {
    name: 'acp',
    version: '2025-09-29.1',
  },
  api_base_url: 'https://realrealgenuine.com',
  transports: ['https', 'mcp'],
  capabilities: {
    services: ['checkout', 'orders', 'delegate_payment'],
    supported_currencies: ['usd'],
    supported_locales: ['en-US'],
  },
  acp: {
    profile: 'https://agenticcommerce.dev',
    version: '2025-09-29.1',
  },
  payment: {
    methods: ['x402', 'usdc-base'],
    token: 'USDC',
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'base-mainnet',
    recipient: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
  },
  identity: {
    standard: 'erc-8004',
    agentId: 33313,
    network: 'base',
    profile: 'https://8004scan.io/agents/base/33313',
  },
  provider: {
    name: 'Real Real Genuine',
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
