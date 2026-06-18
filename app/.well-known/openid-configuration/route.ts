export const dynamic = 'force-static';

const METADATA = {
  issuer: 'https://app.getvia.xyz',
  authorization_endpoint: 'https://app.getvia.xyz/api/oauth/authorize',
  token_endpoint: 'https://app.getvia.xyz/api/oauth/token',
  userinfo_endpoint: 'https://app.getvia.xyz/api/oauth/userinfo',
  jwks_uri: 'https://app.getvia.xyz/.well-known/jwks.json',
  registration_endpoint: 'https://app.getvia.xyz/api/oauth/register',
  response_types_supported: ['code', 'token', 'id_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256', 'ES256'],
  grant_types_supported: [
    'authorization_code',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'urn:ietf:params:oauth:grant-type:wallet-signature',
  ],
  scopes_supported: ['openid', 'agent:read', 'agent:connect', 'mcp:invoke'],
  token_endpoint_auth_methods_supported: [
    'client_secret_post',
    'client_secret_basic',
    'none',
    'wallet_signature',
  ],
  claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'wallet', 'agent_id'],
  code_challenge_methods_supported: ['S256'],
  service_documentation: 'https://app.getvia.xyz/faq',
};

export function GET() {
  return new Response(JSON.stringify(METADATA, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
