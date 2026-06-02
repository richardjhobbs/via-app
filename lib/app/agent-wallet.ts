/**
 * Platform-managed agent/identity wallets.
 *
 * When a store registers without supplying its own agent wallet, the PLATFORM
 * creates one so the user only ever needs their single payout wallet. The
 * wallet is derived DETERMINISTICALLY from one platform-held server seed
 * (AGENT_WALLET_SEED) plus the store id, so:
 *   - no private key is stored at rest (it is always re-derivable),
 *   - every store gets a unique wallet (store id varies),
 *   - the only secret to protect is the single seed.
 *
 * This wallet holds the store's ERC-8004 identity token ONLY. It never holds
 * USDC: sale funds route through the shared platform wallet (registerDrop
 * creator = PLATFORM_WALLET) and auto-payout sweeps 97.5% to the seller's
 * payout wallet. So the seed's blast radius is identity control, not funds.
 *
 * AGENT_WALLET_SEED is NOT a per-user input. It is one platform env var used
 * for all platform-created agent wallets. If it is unset, derivation returns
 * null and register_store falls back to requiring a user-supplied agent wallet.
 */

import crypto from 'crypto';
import { ethers } from 'ethers';

/** True when the platform can mint agent wallets (the seed is configured). */
export function platformAgentWalletsEnabled(): boolean {
  return !!process.env.AGENT_WALLET_SEED;
}

/**
 * Deterministically derive a store's agent/identity wallet from the platform
 * seed + store id. Returns null if AGENT_WALLET_SEED is unset.
 *
 * A SHA-256 HMAC yields 32 bytes, which is a valid secp256k1 private key with
 * overwhelming probability; on the negligible chance it is out of range, we
 * rehash with an incrementing counter until ethers accepts it.
 */
export function deriveAgentWallet(storeId: string): ethers.Wallet | null {
  const seed = process.env.AGENT_WALLET_SEED;
  if (!seed) return null;
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', seed).update(`agent-wallet|${storeId}|${i}`).digest('hex');
    try {
      return new ethers.Wallet(pk);
    } catch {
      // invalid key (out of curve order) — try the next counter
    }
  }
  return null;
}
