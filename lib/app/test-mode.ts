/**
 * Test-mode helpers — shared by the seller + buyer register endpoints.
 *
 * Skips the on-chain ERC-8004 registration when either:
 *   - process.env.VIA_SKIP_ERC8004 === '1'  (project-wide test mode), OR
 *   - the signup email contains "+test" or "+e2e"  (per-user opt-in,
 *     uses Gmail's "+" alias convention so any inbox can run isolated tests).
 *
 * Real production users with normal emails ALWAYS get a real mint. The
 * VIA_SKIP_ERC8004 env var stays unset in production.
 *
 * When test-mode applies we write a synthetic placeholder to
 * erc8004_agent_id so the row is identifiable as a test record and the
 * downstream UI doesn't break on null. Format: `TEST-<8-hex>`.
 */

import { randomBytes } from 'node:crypto';

const TEST_ALIAS_RE = /\+(test|e2e)[^@]*@/i;

export function shouldSkipErc8004(email: string): boolean {
  if (process.env.VIA_SKIP_ERC8004 === '1') return true;
  if (TEST_ALIAS_RE.test(email)) return true;
  return false;
}

export function syntheticTestAgentId(): string {
  return 'TEST-' + randomBytes(4).toString('hex').toUpperCase();
}
