export const dynamic = 'force-static';

const METADATA = {
  issuer: 'https://app.getvia.xyz',
  authorization_endpoint: 'https://app.getvia.xyz/api/oauth/authorize',
  token_endpoint: 'https://app.getvia.xyz/api/oauth/token',
  jwks_uri: 'https://app.getvia.xyz/.well-known/jwks.json',
  registration_endpoint: 'https://app.getvia.xyz/api/oauth/register',
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
  scopes_supported: ['agent:read', 'agent:connect', 'mcp:invoke'],
  code_challenge_methods_supported: ['S256'],
  service_documentation: 'https://app.getvia.xyz/faq',
  ui_locales_supported: ['en'],
  authentication_methods_supported: [
    {
      type: 'wallet_signature',
      description:
        'Agents authenticate by signing a challenge with their ERC-8004 registered wallet.',
      networks: ['base'],
    },
  ],
  agent_auth: {
    skill: 'https://app.getvia.xyz/auth.md',
    register_uri: 'https://app.getvia.xyz/api/oauth/register',
    claim_uri: 'https://app.getvia.xyz/api/oauth/agent/claim',
    revocation_uri: 'https://app.getvia.xyz/api/oauth/revoke',
    identity_endpoint: 'https://app.getvia.xyz/api/oauth/agent/identity',
    claim_endpoint: 'https://app.getvia.xyz/api/oauth/agent/identity/claim',
    events_endpoint: 'https://app.getvia.xyz/api/oauth/agent/event/notify',
    identity_types_supported: ['anonymous', 'identity_assertion', 'service_auth'],
    anonymous: {
      credential_types_supported: ['client_secret_basic', 'client_secret_post'],
    },
    identity_assertion: {
      assertion_types_supported: ['urn:ietf:params:oauth:token-type:id-jag'],
      credential_types_supported: ['urn:ietf:params:oauth:token-type:id-jag'],
    },
    service_auth: {
      credential_types_supported: ['client_secret_basic', 'private_key_jwt'],
    },
    events_supported: [
      'https://schemas.workos.com/events/agent/auth/identity/assertion/revoked',
    ],
  },
};

export function GET() {
  return new Response(JSON.stringify(METADATA, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
