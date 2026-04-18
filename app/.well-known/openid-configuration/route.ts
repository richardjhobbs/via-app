export const dynamic = 'force-static';

const METADATA = {
  issuer: 'https://realrealgenuine.com',
  authorization_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/authorize',
  token_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/token',
  userinfo_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/userinfo',
  jwks_uri: 'https://realrealgenuine.com/.well-known/jwks.json',
  registration_endpoint: 'https://realrealgenuine.com/api/rrg/oauth/register',
  response_types_supported: ['code', 'token', 'id_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256', 'ES256'],
  grant_types_supported: [
    'authorization_code',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'urn:ietf:params:oauth:grant-type:wallet-signature',
  ],
  scopes_supported: [
    'openid',
    'catalogue:read',
    'listing:purchase',
    'design:submit',
    'brand:admin',
    'marketing:join',
    'agent:profile',
  ],
  token_endpoint_auth_methods_supported: [
    'client_secret_post',
    'client_secret_basic',
    'none',
    'wallet_signature',
  ],
  claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'wallet', 'agent_id'],
  code_challenge_methods_supported: ['S256'],
  service_documentation: 'https://realrealgenuine.com/api/rrg/agent-docs',
};

export function GET() {
  return new Response(JSON.stringify(METADATA, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
