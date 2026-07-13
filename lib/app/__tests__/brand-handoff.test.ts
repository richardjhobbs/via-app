/**
 * Guardrail — the RRG brand -> VIA Back Room handoff token crypto boundary.
 *
 * A federated brand is admitted to the Back Room on the strength of a token
 * minted by RRG and verified by VIA against the shared VIA_PLATFORM_SECRET. This
 * token is the attacker-reachable surface: if the signature check regresses,
 * anyone could forge a brand identity into a room. These tests lock the
 * round-trip and every rejection path (tamper, wrong secret, expiry, malformed,
 * wrong kind). The brand session cookie (brand-session.ts) is set server-side
 * from an already-verified token using the identical HMAC construction.
 *
 * Reference: lib/app/backroom/brand-handoff.ts
 *
 * Run via:   npm run test
 * Direct:    node --test --experimental-strip-types lib/app/__tests__/brand-handoff.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.VIA_PLATFORM_SECRET = 'test-secret-brand-handoff';

const { mintBrandHandoffToken, verifyBrandHandoffToken } = await import('../backroom/brand-handoff.ts');

const SECRET = process.env.VIA_PLATFORM_SECRET;
const soon = () => Math.floor(Date.now() / 1000) + 600;
const past = () => Math.floor(Date.now() / 1000) - 10;

const base = {
  platform: 'rrg' as const,
  kind: 'seller' as const,
  slug: 'acme-brand',
  wallet_address: '0x1111111111111111111111111111111111111111',
  name: 'Acme Brand',
};

test('handoff: mint -> verify round-trips and preserves the payload', () => {
  const token = mintBrandHandoffToken({ ...base, exp: soon() }, SECRET);
  const r = verifyBrandHandoffToken(token);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payload.slug, 'acme-brand');
    assert.equal(r.payload.wallet_address, base.wallet_address);
    assert.equal(r.payload.name, 'Acme Brand');
  }
});

test('handoff: a tampered payload is rejected', () => {
  const token = mintBrandHandoffToken({ ...base, exp: soon() }, SECRET);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...base, slug: 'evil-brand', exp: soon() })).toString('base64url');
  const r = verifyBrandHandoffToken(`${forged}.${sig}`);
  assert.equal(r.ok, false);
  assert.ok(payload); // original payload existed
});

test('handoff: a token minted with a different secret is rejected', () => {
  const token = mintBrandHandoffToken({ ...base, exp: soon() }, 'some-other-secret');
  const r = verifyBrandHandoffToken(token);
  assert.equal(r.ok, false);
});

test('handoff: an expired token is rejected', () => {
  const token = mintBrandHandoffToken({ ...base, exp: past() }, SECRET);
  const r = verifyBrandHandoffToken(token);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /expired/);
});

test('handoff: a non-brand payload (wrong kind) is rejected', async () => {
  const bad = Buffer.from(JSON.stringify({ platform: 'rrg', kind: 'buyer', slug: 'x', wallet_address: base.wallet_address, exp: soon() })).toString('base64url');
  const crypto = await import('node:crypto');
  const sig = crypto.createHmac('sha256', SECRET).update(bad).digest().toString('base64url');
  const r = verifyBrandHandoffToken(`${bad}.${sig}`);
  assert.equal(r.ok, false);
});

test('handoff: a malformed token is rejected, not thrown', () => {
  assert.equal(verifyBrandHandoffToken('').ok, false);
  assert.equal(verifyBrandHandoffToken('nodot').ok, false);
  assert.equal(verifyBrandHandoffToken('.onlysig').ok, false);
});
