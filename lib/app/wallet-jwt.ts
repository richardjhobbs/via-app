/**
 * Buyer wallet auto-connect via thirdweb in-app wallet custom JWT (OIDC) auth.
 *
 * Goal: a buyer logged into VIA gets their OWN (non-custodial) thirdweb in-app
 * wallet silently connected at checkout, no email OTP, no wallet chooser. VIA
 * mints a short-lived RS256 JWT for the logged-in buyer; the thirdweb client
 * exchanges it for a wallet session via the `jwt` strategy; thirdweb verifies
 * the signature against the JWKS we publish at /.well-known/jwks.json.
 *
 * CONTINUITY: thirdweb derives the wallet from the JWT `sub`. We set `sub` to the
 * buyer's auth email (and also send the `email` claim) , the same identifier their
 * email/Google-created wallet is keyed by , so the JWT resolves to that SAME
 * funded wallet rather than minting a new empty one. This MUST be confirmed with
 * a live address check before the flow is enabled (NEXT_PUBLIC_VIA_WALLET_JWT_ENABLED).
 *
 * No JWT dependency: node crypto signs RS256 and exports the public JWK.
 * Requires VIA_WALLET_JWT_PRIVATE_KEY (RS256 PEM) and VIA_WALLET_JWT_AUD (the
 * `aud` configured in the thirdweb dashboard). Both unset -> every function is a
 * no-op (null), so the endpoints are inert until configured.
 */
import crypto from 'crypto';

const ALG = 'RS256';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

/** The RS256 private key PEM from env (supports \n-escaped values). Null if unset. */
function privateKeyPem(): string | null {
  const raw = process.env.VIA_WALLET_JWT_PRIVATE_KEY;
  if (!raw) return null;
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  return pem.includes('BEGIN') ? pem : null;
}

/** RFC 7638 JWK thumbprint, used as the stable `kid` linking JWKS to the JWT header. */
function kidFor(jwk: { kty: string; n: string; e: string }): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

/** The public key as a JWKS entry for thirdweb to verify our JWTs. Null if no key. */
export function getPublicJwk(): Record<string, string> | null {
  const pem = privateKeyPem();
  if (!pem) return null;
  try {
    const jwk = crypto.createPublicKey(pem).export({ format: 'jwk' }) as { kty: string; n: string; e: string };
    return { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: ALG, use: 'sig', kid: kidFor(jwk) };
  } catch {
    return null;
  }
}

export interface BuyerWalletClaims { sub: string; email?: string; }

/** Mint a short-lived RS256 JWT for a logged-in buyer. Null if not configured. */
export function signBuyerWalletJwt(claims: BuyerWalletClaims, ttlSeconds = 300): string | null {
  const pem = privateKeyPem();
  const jwk = getPublicJwk();
  const aud = process.env.VIA_WALLET_JWT_AUD;
  if (!pem || !jwk || !aud) return null;

  const iss = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');
  const iat = Math.floor(Date.now() / 1000);
  const header  = { alg: ALG, typ: 'JWT', kid: jwk.kid };
  const payload = {
    iss, aud, sub: claims.sub,
    ...(claims.email ? { email: claims.email } : {}),
    iat, exp: iat + ttlSeconds,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  try {
    const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), pem);
    return `${signingInput}.${b64url(sig)}`;
  } catch {
    return null;
  }
}

/** Whether the JWT wallet-auth path is fully configured server-side. */
export function walletJwtConfigured(): boolean {
  return Boolean(privateKeyPem() && getPublicJwk() && process.env.VIA_WALLET_JWT_AUD);
}
