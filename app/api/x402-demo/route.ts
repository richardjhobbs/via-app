import type { NextRequest } from 'next/server';

const X402_RESPONSE = {
  x402Version: 1,
  error: 'X-PAYMENT header is required',
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '10000',
      resource: 'https://app.getvia.xyz/api/x402-demo',
      description: 'VIA x402 demo endpoint. Any agent paying 0.01 USDC on Base can fetch a signed timestamp.',
      mimeType: 'application/json',
      payTo: '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d',
      maxTimeoutSeconds: 60,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: {
        name: 'USDC',
        decimals: 6,
      },
    },
  ],
};

export function GET(req: NextRequest) {
  const payment = req.headers.get('x-payment');
  if (!payment) {
    return new Response(JSON.stringify(X402_RESPONSE, null, 2), {
      status: 402,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer realm="x402"',
      },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      timestamp: new Date().toISOString(),
      note: 'Demo success. In a real implementation the facilitator verifies the payment before this 200 is returned.',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-payment-response': 'verified:stub',
      },
    },
  );
}
