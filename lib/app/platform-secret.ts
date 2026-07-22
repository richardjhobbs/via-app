/**
 * Incoming platform-secret gate for RRG -> VIA server-to-server calls.
 *
 * Symmetric to RRG's `secretOk` (rrg/app/api/via/identity/route.ts): the caller
 * presents the shared VIA_PLATFORM_SECRET in the `x-via-platform-secret` header.
 * Used by the buyer-unification endpoints RRG reads (canonical identity + credit
 * balance for a migrated buyer agent). Timing-safe compare.
 */
import crypto from 'crypto';

export function platformSecretOk(req: Request): boolean {
  const expected = process.env.VIA_PLATFORM_SECRET;
  const got = req.headers.get('x-via-platform-secret');
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
