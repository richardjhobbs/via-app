/**
 * RRG -> VIA concierge handoff token.
 *
 * When an owner clicks "Bring my concierge to VIA" on RRG, RRG mints a
 * short-lived signed token and redirects to app.getvia.xyz/onboard/link. The
 * token is the ownership proof: RRG vouches (via its own logged-in session)
 * that the bearer owns the named concierge, so via-app does not need a wallet
 * signature (which would fail for thirdweb embedded wallets).
 *
 * The token is an HMAC-SHA256 over a base64url JSON payload, keyed by
 * VIA_PLATFORM_SECRET , the SAME secret both platforms already share to talk to
 * the VIA registrar (lib/agent/erc8004.ts). Format: `<payload>.<sig>`.
 *
 * RRG mints with the identical algorithm; keep the two in lockstep.
 */
import crypto from 'crypto';

export interface HandoffPayload {
  /** RRG agent_agents.id , the concierge being imported. */
  rrg_agent_id: string;
  /** The concierge's funding wallet (becomes the VIA buyer's funding wallet). */
  wallet_address: string;
  /** Optional display name carried through so the buyer has a name pre-mint. */
  display_name?: string;
  /** Unix seconds expiry. RRG mints these short-lived (~10 min). */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** Mint a handoff token. Used by RRG; kept here so both sides share one impl. */
export function mintHandoffToken(payload: HandoffPayload, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type VerifyResult =
  | { ok: true; payload: HandoffPayload }
  | { ok: false; error: string };

/**
 * Verify a handoff token against VIA_PLATFORM_SECRET. Checks the HMAC with a
 * timing-safe compare, then the expiry. Returns the decoded payload on success.
 */
export function verifyHandoffToken(token: string): VerifyResult {
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

  let payload: HandoffPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as HandoffPayload;
  } catch {
    return { ok: false, error: 'undecodable payload' };
  }

  if (!payload.rrg_agent_id || !payload.wallet_address) {
    return { ok: false, error: 'incomplete payload' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    return { ok: false, error: 'token expired' };
  }
  return { ok: true, payload };
}
