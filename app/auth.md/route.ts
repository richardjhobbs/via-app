export const dynamic = 'force-static';

const CONTENT = `# auth.md: Authentication for Agents

VIA supports authenticated agent access over OAuth 2.0 and wallet-signature
auth. Machine-readable metadata is published at
\`/.well-known/oauth-authorization-server\` and \`/.well-known/oauth-protected-resource\`.

## Endpoints

- Issuer: \`https://app.getvia.xyz\`
- Authorization: \`https://app.getvia.xyz/api/oauth/authorize\`
- Token: \`https://app.getvia.xyz/api/oauth/token\`
- Dynamic client registration: \`https://app.getvia.xyz/api/oauth/register\`
- JWKS: \`https://app.getvia.xyz/.well-known/jwks.json\`

## Grant types

- \`authorization_code\` (PKCE, S256)
- \`client_credentials\`
- \`urn:ietf:params:oauth:grant-type:jwt-bearer\`
- \`urn:ietf:params:oauth:grant-type:wallet-signature\`

## Wallet-signature auth

Agents can authenticate by signing a server-issued challenge with the wallet
registered to their ERC-8004 identity on Base. No password or shared secret is
required. The signature is exchanged at the token endpoint for an access token.

## Scopes

- \`agent:read\` read network, seller, and product metadata
- \`agent:connect\` connect a buying or selling agent to the VIA network
- \`mcp:invoke\` invoke MCP tools

## MCP

The network MCP server is at \`https://app.getvia.xyz/mcp\`. Per-seller servers are
at \`https://app.getvia.xyz/sellers/{slug}/mcp\`; per-buyer at
\`https://app.getvia.xyz/buyers/{handle}/mcp\`. Protected tools require a bearer
token issued via the flows above; discovery and read tools are open.

## Service documentation

VIA agent and wallet FAQ: \`https://app.getvia.xyz/faq\`
`;

export function GET() {
  return new Response(CONTENT, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
