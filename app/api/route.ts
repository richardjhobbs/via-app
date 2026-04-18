const X402 = {
  x402Version: 1,
  error: 'X-PAYMENT header is required',
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '10000',
      resource: 'https://realrealgenuine.com/api',
      description:
        'RRG API gateway. Per-call access requires payment. See MCP server card for per-tool pricing, or use the free /api/rrg/catalogue and /api/rrg/agent-docs endpoints.',
      mimeType: 'application/json',
      payTo: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
      maxTimeoutSeconds: 60,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: {
        name: 'USDC',
        decimals: 6,
      },
    },
  ],
  hint: {
    mcp: 'https://realrealgenuine.com/mcp',
    agentCard: 'https://realrealgenuine.com/.well-known/agent-card.json',
    apiCatalog: 'https://realrealgenuine.com/.well-known/api-catalog',
    x402Discovery: 'https://realrealgenuine.com/.well-known/x402',
    freeEndpoints: [
      'https://realrealgenuine.com/api/rrg/catalogue',
      'https://realrealgenuine.com/api/rrg/agent-docs',
    ],
  },
};

export function GET() {
  return new Response(JSON.stringify(X402, null, 2), {
    status: 402,
    headers: {
      'content-type': 'application/vnd.x402+json',
      'x-payment-required': '1',
      'x402-version': '1',
      'accept-payment': 'USDC; network=base; pay-to=0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed; asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'www-authenticate': 'X402 realm="realrealgenuine.com", resource_metadata="https://realrealgenuine.com/.well-known/oauth-protected-resource"',
      link: '</.well-known/x402>; rel="describedby"; type="application/json"',
    },
  });
}
