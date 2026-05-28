/**
 * Test-mode helpers — shared by the seller + buyer register endpoints and
 * the onboard/wallet client pages.
 *
 * Skips the on-chain ERC-8004 registration AND the thirdweb agent-wallet
 * provisioning when either:
 *   - process.env.VIA_SKIP_ERC8004 === '1'  (project-wide test mode), OR
 *   - the signup email contains "+test" or "+e2e"  (per-user opt-in,
 *     uses Gmail's "+" alias convention so any inbox can run isolated tests).
 *
 * Real production users with normal emails ALWAYS get a real mint and a
 * real thirdweb wallet. VIA_SKIP_ERC8004 stays unset in prod.
 *
 * When test-mode applies we write a synthetic placeholder to
 * erc8004_agent_id (format: `TEST-<8-hex>`) and substitute a deterministic
 * test wallet derived from the email (format: `0x00000000<32-hex>`). The
 * `0x00000000` prefix is the visual signal that this is a stub address —
 * the chance of a real EOA starting with eight zero hex chars is 1 in 2^32.
 *
 * IMPORTANT: this file must stay browser-safe — no `node:crypto` imports at
 * the top level. The client wallet pages read `isTestEmail()` and
 * `syntheticTestWallet()` directly.
 */

const TEST_ALIAS_RE = /\+(test|e2e)[^@]*@/i;

export function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return TEST_ALIAS_RE.test(email);
}

export function shouldSkipErc8004(email: string): boolean {
  if (process.env.VIA_SKIP_ERC8004 === '1') return true;
  return isTestEmail(email);
}

export function syntheticTestAgentId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return 'TEST-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Deterministic test agent wallet derived from the email. Always returns
 * the same address for the same email so test runs are reproducible.
 * NOT a real wallet — cannot sign. Used only in test-mode UI flows to
 * bypass thirdweb's email-OTP step.
 */
export function syntheticTestWallet(email: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(email.toLowerCase().trim());
  // FNV-1a 32-bit, then rotated four times to fill 16 bytes (32 hex chars).
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h = (h ^ b) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const out: string[] = [];
  let state = h >>> 0;
  for (let i = 0; i < 4; i++) {
    state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) >>> 0) ^ (i + 1);
    out.push(state.toString(16).padStart(8, '0'));
  }
  return '0x00000000' + out.join('');
}
