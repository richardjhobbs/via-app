/**
 * RRG personal concierge -> VIA Back Room handoff token (rrg/buyer).
 *
 * The concierge counterpart to brand-handoff.ts. A personal concierge that has
 * been seated in a room as a federated rrg/buyer member has no VIA inbox to
 * walk into the room UI. This handoff lets the concierge's owner click "Back
 * Room" on their RRG dashboard and open a VIA concierge session
 * (concierge-session.ts) recognised as that federated member, exactly the way a
 * brand does. Nothing is imported; the concierge stays federated.
 *
 * `ref` is the concierge NAME, which is what a concierge is seated under, so the
 * session matches the membership. Same HMAC construction as brand-handoff,
 * keyed by VIA_PLATFORM_SECRET. RRG mints with the identical algorithm.
 */
import crypto from 'crypto';

export interface ConciergeHandoffPayload {
  platform: 'rrg';
  kind: 'buyer';
  /** The concierge name it is seated under (the membership ref). */
  ref: string;
  /** The concierge's own wallet (cached on the membership row for auth). */
  wallet_address: string;
  /** Display name (same as ref). */
  name?: string;
  /** Optional room to drop straight into. */
  room_id?: string;
  /** Unix seconds expiry. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** Mint a concierge handoff token. Used by RRG; kept here so both share one impl. */
export function mintConciergeHandoffToken(payload: ConciergeHandoffPayload, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type VerifyConciergeResult =
  | { ok: true; payload: ConciergeHandoffPayload }
  | { ok: false; error: string };

/** Verify a concierge handoff token against VIA_PLATFORM_SECRET (HMAC + expiry). */
export function verifyConciergeHandoffToken(token: string): VerifyConciergeResult {
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

  let payload: ConciergeHandoffPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ConciergeHandoffPayload;
  } catch {
    return { ok: false, error: 'undecodable payload' };
  }

  if (payload.platform !== 'rrg' || payload.kind !== 'buyer') {
    return { ok: false, error: 'not a concierge handoff' };
  }
  if (!payload.ref || !payload.wallet_address) {
    return { ok: false, error: 'incomplete payload' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    return { ok: false, error: 'token expired' };
  }
  return { ok: true, payload };
}
