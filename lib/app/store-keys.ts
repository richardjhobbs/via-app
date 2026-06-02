/**
 * Per-store agent management keys.
 *
 * A store key (`via_sk_<48 hex>`) lets the owning agent manage its catalogue
 * over the management MCP without the dashboard session cookie. We persist only
 * the SHA-256 hash on app_sellers.agent_api_key_hash; the plaintext is shown
 * once, at the email+password exchange, and rotated on each exchange.
 */

import crypto from 'crypto';

export function generateStoreKey(): string {
  return 'via_sk_' + crypto.randomBytes(24).toString('hex');
}

export function hashStoreKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Constant-time check of a presented key against a stored hash. False on any
 * missing input so an unprovisioned store (null hash) always fails closed.
 */
export function verifyStoreKey(presented: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!presented || !storedHash) return false;
  const presentedHash = hashStoreKey(presented);
  const a = Buffer.from(presentedHash);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
