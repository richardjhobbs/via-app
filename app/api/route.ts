const PAYMENT_REQUIRED = {
  x402Version: 2,
  error: 'Payment required',
  resource: {
    url: 'https://realrealgenuine.com/api',
    description:
      'RRG API gateway. Per-call access requires payment in USDC on Base. Free endpoints: /api/rrg/catalogue and /api/rrg/agent-docs.',
  },
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      maxAmountRequired: '10000',
      resource: 'https://realrealgenuine.com/api',
      description:
        'RRG API gateway. 0.01 USDC per call, settled on Base to RRG platform wallet 0xbfd71e...',
      mimeType: 'application/json',
      payTo: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
      maxTimeoutSeconds: 60,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: {
        name: 'USDC',
        version: '2',
        decimals: 6,
      },
    },
  ],
};

function encodeHeader(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

const PAYMENT_REQUIRED_HEADER = encodeHeader(PAYMENT_REQUIRED);

const BODY = {
  hint: 'Pay via x402 to access this endpoint. Free endpoints: /api/rrg/catalogue, /api/rrg/agent-docs.',
  mcp: 'https://realrealgenuine.com/mcp',
  agent_card: 'https://realrealgenuine.com/.well-known/agent-card.json',
  x402_discovery: 'https://realrealgenuine.com/.well-known/x402',
};

export function GET() {
  return new Response(JSON.stringify(BODY, null, 2), {
    status: 402,
    headers: {
      'content-type': 'application/json',
      'payment-required': PAYMENT_REQUIRED_HEADER,
      'x402-version': '2',
      'www-authenticate': 'X402 realm="realrealgenuine.com"',
      link: '</.well-known/x402>; rel="describedby"; type="application/json"',
    },
  });
}
