#!/usr/bin/env node
// Derive a brand's per-brand concierge key:
//   HMAC_SHA256(CONCIERGE_KEY_SECRET, lower(slug)) -> hex
// Must stay identical to lib/rrg/auth.ts conciergeKeyFor(). The output is the
// x-concierge-secret that brand's concierge presents; it validates ONLY for
// /api/brand/<slug>/concierge/*, never another brand. The root secret is
// read from env and never printed.
//
// Usage: CONCIERGE_KEY_SECRET=... node scripts/concierge-key.mjs <brand-slug>
import crypto from 'node:crypto';

const slug = (process.argv[2] || '').trim().toLowerCase();
if (!slug) {
  console.error('usage: node scripts/concierge-key.mjs <brand-slug>');
  process.exit(2);
}
const root = process.env.CONCIERGE_KEY_SECRET;
if (!root) {
  console.error('CONCIERGE_KEY_SECRET not set in env');
  process.exit(2);
}
const key = crypto.createHmac('sha256', root).update(slug).digest('hex');
process.stdout.write(key + '\n');
