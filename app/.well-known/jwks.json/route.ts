/**
 * JWKS for thirdweb in-app wallet custom JWT auth. Publishes the RS256 public
 * key so thirdweb can verify the buyer wallet JWTs VIA mints (see lib/app/wallet-jwt.ts).
 * Returns an empty key set until VIA_WALLET_JWT_PRIVATE_KEY is configured, so the
 * endpoint is safe to ship before the wallet-auth flow is enabled.
 *
 * thirdweb dashboard custom-auth config points its "JWKS URI" at this URL.
 */
import { NextResponse } from 'next/server';
import { getPublicJwk } from '@/lib/app/wallet-jwt';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jwk = getPublicJwk();
  return NextResponse.json(
    { keys: jwk ? [jwk] : [] },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
