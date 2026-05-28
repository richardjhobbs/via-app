export const dynamic = 'force-static';

const APP_BASE = 'https://app.getvia.xyz';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d';

const X402 = {
  x402Version: 1,
  protocol: 'https://x402.org',
  supported: true,
  networks: ['base-mainnet'],
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      asset: USDC_BASE,
      payTo: PLATFORM_WALLET,
      description: 'Pay for a VIA per-seller buy_product action in USDC on Base.',
    },
  ],
  facilitators: ['https://x402.org/facilitator'],
  settle: `${APP_BASE}/api/x402/purchase`,
  buy_product_endpoint: `${APP_BASE}/sellers/{slug}/mcp`,
  docs: `${APP_BASE}/.well-known/mcp/server-card.json`,
};

export function GET() {
  return new Response(JSON.stringify(X402, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
