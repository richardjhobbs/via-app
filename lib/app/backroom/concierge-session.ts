/**
 * RRG personal concierge session for the Back Room human UI.
 *
 * The rrg/buyer counterpart to brand-session.ts. Once a concierge handoff is
 * verified (concierge-handoff.ts), VIA opens this thin signed cookie proving the
 * bearer controls the concierge seated as <ref> with wallet <wallet>. ui-auth
 * reads it so the concierge is recognised as owning its rrg/buyer member ref,
 * and every existing room/hub flow works with no separate login.
 *
 * Signed the same way as the handoff (HMAC-SHA256, keyed by VIA_PLATFORM_SECRET).
 */
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE = 'via-rrg-concierge';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

export interface ConciergeSession {
  ref: string;
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

export function encodeConciergeSession(session: ConciergeSession, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(session), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function setConciergeSessionCookie(response: NextResponse, session: ConciergeSession): void {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) throw new Error('VIA_PLATFORM_SECRET not configured');
  response.cookies.set(COOKIE, encodeConciergeSession(session, secret), COOKIE_OPTIONS);
}

export function clearConciergeSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}

/** Read + verify the concierge session. Null when absent, forged, or expired. */
export async function getConciergeSession(): Promise<ConciergeSession | null> {
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

  let session: ConciergeSession;
  try {
    session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ConciergeSession;
  } catch {
    return null;
  }
  if (!session.ref || !session.wallet) return null;
  if (typeof session.exp !== 'number' || session.exp * 1000 < Date.now()) return null;
  return session;
}
