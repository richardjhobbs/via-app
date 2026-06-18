/**
 * scripts/place-seller-keys.mjs
 *
 * One-shot operator tool: assemble the per-seller x402 signing key map and place
 * it on the Box for the seller agent. The map is { "<slug>": { privkey,
 * erc8004_id } }. RRG brand keys come from the RRG credential files (by wallet
 * address); the 3 VIA seller keys are DERIVED from AGENT_WALLET_SEED (same
 * deriveAgentWallet HMAC the app uses) and self-checked against their on-record
 * agent wallet. The full map is written to an OS temp file, scp'd to the Box at
 * ~/.via-seller-agent-keys.json, and the temp file deleted. Keys are never
 * printed to stdout.
 *
 * AGENT_WALLET_SEED must be in the env or via-app/.env.local for the VIA keys.
 * If it is absent the VIA sellers are skipped (with a loud warning) and only the
 * RRG keys are placed.
 *
 * Box: 100.80.225.34 (agent reads VIA_SELLER_KEYS_FILE / ~/.via-seller-agent-keys.json).
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RRG_TMP = 'C:/Users/Richard/Documents/rrg/tmp';
const BOX = '100.80.225.34';

// Load AGENT_WALLET_SEED from via-app/.env.local if not already in the env.
if (!process.env.AGENT_WALLET_SEED) {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, ''); }
    }
  }
}

// VIA platform sellers: derived (no cred file). slug -> { store id, on-record
// agent_wallet_address for the self-check, erc8004 id }. (app_sellers, 2026-06-16)
const VIA_SELLERS = [
  { slug: 'drhobbs-knowledge',    id: 'dd0e81fd-586b-4196-99f3-5f3ed2974ad6', w: '0x35bcf708834d1c38187a49705dfd7997b551d418', e: '55552' },
  { slug: 'eli-s-artisan-bakery', id: 'e6a32d65-c452-4e07-9393-4fd4c8e8fd6e', w: '0xca11b205de3e4f52cc9b6ba4be1276a88b7cc33f', e: '55593' },
  { slug: 'the-sentient-startup', id: '0296cc76-6e88-4459-b978-aea036a893d7', w: '0xbfa26fba52fe8bd4d2dd28a25f85220cd5e5b3bc', e: '55594' },
];

function deriveAgentWallet(storeId) {
  const seed = process.env.AGENT_WALLET_SEED;
  if (!seed) return null;
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', seed).update(`agent-wallet|${storeId}|${i}`).digest('hex');
    try { return new ethers.Wallet(pk); } catch { /* out of curve order, try next */ }
  }
  return null;
}

// slug -> { payer wallet (lowercased), erc8004_id }. UU pays from its concierge
// (agent) wallet 0xe9cedF, which owns the identity, NOT its brand payout wallet.
const TARGETS = {
  'clooudie':                { w: '0xca5c9c4da1787fea491ed6c94e86b04ec46be61d', e: '45691' },
  'nolo':                    { w: '0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d', e: '45690' },
  'tyo':                     { w: '0xf78cb04c28e1898638ee4322f4b7b91ee8c0db00', e: '47353' },
  'university-of-diversity': { w: '0xb8ca93c837cdcb09ab7e0d61a740fd95d25d7961', e: '47320' },
  'les-basics':              { w: '0x8d566ed9a15f38439465405f654416f1276f25b3', e: '51037' },
  'gumball-3000':            { w: '0x154bbd968dece4957c7604c8188a8048888de3f9', e: '51174' },
  'philleywood':             { w: '0x35df756e97efd1db987e192ccefbf1b210bf4179', e: '50992' },
  'pitchers-only':           { w: '0x03e1fc8bf74e11a1fb75d7fc54c1b613fd627d9d', e: '54261' },
  'livvium':                 { w: '0x52b406dd49e8fe0cc147e73f1c16ee04530241f5', e: '55582' },
  'jennys':                  { w: '0xe206d575572e563a490f4f63e7f8c45b11f87dd6', e: '55583' },
  'frey-tailored':           { w: '0x30b1e8cc377a75d9664c26415a820c4925afa595', e: '45686' },
  'unknown-union':           { w: '0xe9cedf6453b61771505404b47671602eaa158881', e: '44897' },
};

// Index every (address -> privkey) found across the RRG credential files.
const idx = new Map();
function walk(o) {
  if (o && typeof o === 'object') {
    const pk = o.privateKey || o.private_key || o.wallet_private_key;
    if (typeof pk === 'string' && /^0x[0-9a-fA-F]{64}$/.test(pk)) {
      try { idx.set(new ethers.Wallet(pk).address.toLowerCase(), pk); } catch { /* skip */ }
    }
    for (const v of Object.values(o)) walk(v);
  }
}
for (const f of fs.readdirSync(RRG_TMP).filter((f) => f.endsWith('.json'))) {
  try { walk(JSON.parse(fs.readFileSync(path.join(RRG_TMP, f), 'utf8'))); } catch { /* skip */ }
}

const map = {};
const missing = [];
for (const [slug, t] of Object.entries(TARGETS)) {
  const pk = idx.get(t.w);
  if (pk) map[slug] = { privkey: pk, erc8004_id: t.e };
  else missing.push(slug);
}

// VIA sellers: derive from AGENT_WALLET_SEED, self-check each derived address
// against the on-record agent wallet. A mismatch means the wrong seed: abort
// rather than place bad keys. If the seed is absent, skip the 3 with a warning.
if (process.env.AGENT_WALLET_SEED) {
  for (const v of VIA_SELLERS) {
    const w = deriveAgentWallet(v.id);
    if (!w) { console.error(`FATAL: could not derive a valid key for ${v.slug}`); process.exit(1); }
    if (w.address.toLowerCase() !== v.w.toLowerCase()) {
      console.error(`FATAL: ${v.slug} derived ${w.address} but on record is ${v.w} — wrong AGENT_WALLET_SEED. Nothing placed.`);
      process.exit(1);
    }
    map[v.slug] = { privkey: w.privateKey, erc8004_id: v.e };
  }
  console.log(`derived + verified 3 VIA seller keys (drhobbs-knowledge, eli-s-artisan-bakery, the-sentient-startup)`);
} else {
  console.warn('WARNING: AGENT_WALLET_SEED not set — placing RRG keys only, VIA sellers skipped.');
  for (const v of VIA_SELLERS) missing.push(v.slug);
}

const tmpFile = path.join(os.tmpdir(), `via-keys-${process.pid}.json`);
fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2));
try {
  execFileSync('scp', ['-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new', tmpFile, `${BOX}:.via-seller-agent-keys.json`], { stdio: 'inherit' });
  console.log(`placed ${Object.keys(map).length} seller keys on the Box ~/.via-seller-agent-keys.json`);
  console.log('slugs:', Object.keys(map).join(', '));
  if (missing.length) console.log('MISSING keys for:', missing.join(', '));
} finally {
  fs.rmSync(tmpFile, { force: true });
}
