export const dynamic = 'force-static';

// JWKS for Web Bot Auth (IETF webbotauth WG + Cloudflare bot verification).
// RRG signs outbound bot/agent requests with the matching private key
// (stored in WBA_PRIVATE_JWK env var, never committed) so receiving sites
// can verify the signature against these public keys.
//
// Served per RFC 9421 (HTTP Message Signatures) directory convention.

const JWKS = {
  keys: [
    {
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'TwKJs4V_nKmshaMMHrg_Z-DkMT8LDrk3EGPpbh2zrNg',
      kid: 'rrg-wba-20260418',
      use: 'sig',
      alg: 'EdDSA',
    },
  ],
};

export function GET() {
  return new Response(JSON.stringify(JWKS, null, 2), {
    headers: {
      'content-type': 'application/jwk-set+json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
