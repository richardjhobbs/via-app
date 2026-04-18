export const dynamic = 'force-static';

const X402 = {
  x402Version: 1,
  protocol: 'https://x402.org',
  supported: true,
  networks: ['base-mainnet'],
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
      description: 'Pay per action on the RRG platform in USDC on Base.',
    },
  ],
  facilitators: ['https://x402.org/facilitator'],
  demoEndpoint: 'https://realrealgenuine.com/api/x402-demo',
  docs: 'https://realrealgenuine.com/api/rrg/agent-docs',
};

export function GET() {
  return new Response(JSON.stringify(X402, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
