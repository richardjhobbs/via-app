/**
 * Minds -> VIA buyer link token.
 *
 * A buyer owner connects their Minds agent (hellominds.ai, e.g. the via.concierge
 * Mind) to one VIA buying agent so the Mind can push a shopping-preference
 * appraisal it derived from the owner's email. The owner mints this short-lived
 * signed token from their VIA dashboard and pastes it into their Mind; the Mind
 * presents it when it calls the appraisal-import surface (REST or the central
 * MCP tool). The token is the authorisation: it scopes a Mind to exactly one
 * app_buyers row, so no per-buyer login or wallet signature is needed.
 *
 * Same construction as the RRG handoff token (lib/app/rrg-handoff.ts): an
 * HMAC-SHA256 over a base64url JSON payload, keyed by VIA_PLATFORM_SECRET.
 * Format: `<payload>.<sig>`.
 */
import crypto from 'crypto';

export interface MindLinkPayload {
  /** app_buyers.id this token authorises writes to. */
  buyer_id: string;
  /** The buyer handle, carried for display + sanity checks. */
  handle: string;
  /** Unix seconds expiry. Minted short-lived (default ~24h). */
  exp: number;
}

/** Default token lifetime in seconds (24h): long enough for the Mind to run an
 *  email appraisal pass, short enough to limit a leaked token's blast radius. */
export const MIND_LINK_TTL_SECONDS = 24 * 60 * 60;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** Mint a link token for a buyer. Returns null if the platform secret is unset. */
export function mintMindLinkToken(
  buyerId: string,
  handle: string,
  ttlSeconds: number = MIND_LINK_TTL_SECONDS,
): string | null {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) return null;
  const payload: MindLinkPayload = {
    buyer_id: buyerId,
    handle,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds),
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type MindLinkVerifyResult =
  | { ok: true; payload: MindLinkPayload }
  | { ok: false; error: string };

/**
 * Verify a link token against VIA_PLATFORM_SECRET. Timing-safe HMAC compare,
 * then expiry. Returns the decoded payload on success.
 */
export function verifyMindLinkToken(token: string): MindLinkVerifyResult {
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) return { ok: false, error: 'VIA_PLATFORM_SECRET not configured' };

  const dot = token.indexOf('.');
  if (dot < 1) return { ok: false, error: 'malformed token' };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'bad signature' };
  }

  let payload: MindLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as MindLinkPayload;
  } catch {
    return { ok: false, error: 'undecodable payload' };
  }

  if (!payload.buyer_id || !payload.handle) {
    return { ok: false, error: 'incomplete payload' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    return { ok: false, error: 'token expired' };
  }
  return { ok: true, payload };
}
