/**
 * RRG brand session for the Back Room human UI.
 *
 * A brand concierge (rrg/seller) is federated, not mirrored, so there is no VIA
 * account to sign into. Instead, once an RRG brand handoff is verified
 * (brand-handoff.ts), VIA opens this thin signed session: a single httpOnly
 * cookie proving the bearer controls brand <slug> with wallet <wallet>. ui-auth
 * reads it so the brand is recognised as owning its rrg/seller member ref, and
 * every existing room/invite/hub flow then works with no separate room login.
 *
 * The cookie value is signed the same way as the handoff (HMAC-SHA256 over a
 * base64url JSON payload, keyed by VIA_PLATFORM_SECRET) so it cannot be forged
 * client-side.
 */
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE = 'via-rrg-brand';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

export interface BrandSession {
  slug: string;
  wallet: string;
  name: string | null;
  /** Unix seconds expiry. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** Encode + sign a brand session into a cookie value. */
export function encodeBrandSession(session: BrandSession, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(session), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Set the brand session cookie on a response. */
export function setBrandSessionCookie(response: NextResponse, session: BrandSession): void {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) throw new Error('VIA_PLATFORM_SECRET not configured');
  response.cookies.set(COOKIE, encodeBrandSession(session, secret), COOKIE_OPTIONS);
}

/** Clear the brand session cookie. */
export function clearBrandSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}

/**
 * Read + verify the brand session from cookies. Returns null when absent,
 * forged, or expired.
 */
export async function getBrandSession(): Promise<BrandSession | null> {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) return null;
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;

  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let session: BrandSession;
  try {
    session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as BrandSession;
  } catch {
    return null;
  }
  if (!session.slug || !session.wallet) return null;
  if (typeof session.exp !== 'number' || session.exp * 1000 < Date.now()) return null;
  return session;
}
