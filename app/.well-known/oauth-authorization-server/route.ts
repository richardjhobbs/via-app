export const dynamic = 'force-static';

const METADATA = {
  issuer: 'https://realrealgenuine.com',
  authorization_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/authorize',
  token_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/token',
  jwks_uri: 'https://realrealgenuine.com/.well-known/jwks.json',
  registration_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/register',
  grant_types_supported: [
    'authorization_code',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'urn:ietf:params:oauth:grant-type:wallet-signature',
  ],
  response_types_supported: ['code', 'token'],
  token_endpoint_auth_methods_supported: [
    'client_secret_post',
    'client_secret_basic',
    'none',
    'wallet_signature',
  ],
  scopes_supported: [
    'catalogue:read',
    'listing:purchase',
    'design:submit',
    'brand:admin',
    'marketing:join',
    'agent:profile',
  ],
  code_challenge_methods_supported: ['S256'],
  service_documentation: 'https://realrealgenuine.com/api/rrg/agent-docs',
  ui_locales_supported: ['en'],
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
