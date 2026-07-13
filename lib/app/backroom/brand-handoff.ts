/**
 * RRG brand -> VIA Back Room handoff token.
 *
 * The brand counterpart to lib/app/rrg-handoff.ts (which handles the PERSONAL
 * concierge, rrg/buyer, imported as a native via/buyer). A brand concierge
 * (rrg/seller) is never mirrored into VIA: it stays a federated member whose
 * wallet is cached on app_room_members.member_wallet. So this handoff does not
 * import anything, it only proves "RRG vouches the bearer controls brand
 * <slug>, wallet <wallet>" so VIA can open a brand session (brand-session.ts)
 * and let the existing room/invite/hub flows recognise it.
 *
 * Same construction as rrg-handoff: HMAC-SHA256 over a base64url JSON payload,
 * keyed by VIA_PLATFORM_SECRET (the secret both platforms already share). Format
 * `<payload>.<sig>`. RRG mints with the identical algorithm; keep them in
 * lockstep.
 */
import crypto from 'crypto';

export interface BrandHandoffPayload {
  platform: 'rrg';
  kind: 'seller';
  /** RRG brand slug , the concierge being brought across. */
  slug: string;
  /** The brand's own EOA wallet (cached on the membership row for auth). */
  wallet_address: string;
  /** Optional brand display name, carried through so the UI has a name. */
  name?: string;
  /** Optional room to drop straight into (when the entry names one). */
  room_id?: string;
  /** Unix seconds expiry. RRG mints these short-lived (~10 min). */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** Mint a brand handoff token. Used by RRG; kept here so both sides share one impl. */
export function mintBrandHandoffToken(payload: BrandHandoffPayload, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type VerifyBrandResult =
  | { ok: true; payload: BrandHandoffPayload }
  | { ok: false; error: string };

/**
 * Verify a brand handoff token against VIA_PLATFORM_SECRET: HMAC (timing-safe),
 * then expiry. Returns the decoded payload on success.
 */
export function verifyBrandHandoffToken(token: string): VerifyBrandResult {
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

  let payload: BrandHandoffPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as BrandHandoffPayload;
  } catch {
    return { ok: false, error: 'undecodable payload' };
  }

  if (payload.platform !== 'rrg' || payload.kind !== 'seller') {
    return { ok: false, error: 'not a brand handoff' };
  }
  if (!payload.slug || !payload.wallet_address) {
    return { ok: false, error: 'incomplete payload' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    return { ok: false, error: 'token expired' };
  }
  return { ok: true, payload };
}
