#!/usr/bin/env node
// Derive a seller's per-seller concierge key:
//   HMAC_SHA256(CONCIERGE_KEY_SECRET, lower(slug)) -> hex
// Must stay identical to lib/app/auth.ts conciergeKeyFor(). The output is
// the x-concierge-secret the Hermes Sales Agent presents; it validates
// ONLY for /api/sellers/<slug>/concierge/*, never another seller. The root
// secret is read from env and never printed.
//
// Usage: CONCIERGE_KEY_SECRET=... node scripts/concierge-key.mjs <seller-slug>
import crypto from 'node:crypto';

const slug = (process.argv[2] || '').trim().toLowerCase();
if (!slug) {
  console.error('usage: node scripts/concierge-key.mjs <seller-slug>');
  process.exit(2);
}
const root = process.env.CONCIERGE_KEY_SECRET;
if (!root) {
  console.error('CONCIERGE_KEY_SECRET not set in env');
  process.exit(2);
}
const key = crypto.createHmac('sha256', root).update(slug).digest('hex');
process.stdout.write(key + '\n');
