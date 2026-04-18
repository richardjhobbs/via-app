export const dynamic = 'force-static';

const METADATA = {
  resource: 'https://realrealgenuine.com',
  authorization_servers: ['https://realrealgenuine.com'],
  scopes_supported: [
    'catalogue:read',
    'listing:purchase',
    'design:submit',
    'brand:admin',
    'marketing:join',
    'agent:profile',
  ],
  bearer_methods_supported: ['header'],
  resource_signing_alg_values_supported: ['RS256', 'ES256'],
  resource_documentation: 'https://realrealgenuine.com/api/rrg/agent-docs',
  authentication_methods_supported: [
    {
      type: 'wallet_signature',
      description:
        'Agents authenticate by signing a challenge with their ERC-8004 registered wallet.',
      networks: ['base'],
    },
  ],
};

export function GET() {
  return new Response(JSON.stringify(METADATA, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
