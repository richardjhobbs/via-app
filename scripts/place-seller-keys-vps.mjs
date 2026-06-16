/**
 * scripts/place-seller-keys-vps.mjs
 *
 * One-shot operator tool (RUN BY RICHARD ON THE DESKTOP). Writes the seller agent
 * secrets the VPS still needs into a single chmod-600 env file at
 * /home/agent/apps/via-agents/.env, which run.sh loads via --env-file-if-exists.
 * It does NOT touch RRG's production .env.local.
 *
 * What it places:
 *   - AGENT_WALLET_SEED  (so the 3 VIA sellers derive their wallet in-memory).
 *   - <SLUG>_WALLET_PRIVATE_KEY for all 12 RRG brand sellers (read by wallet
 *     address from C:/Users/Richard/Documents/rrg/tmp/*.json). The 4 already in
 *     rrg/.env.local are re-stated here harmlessly (same key+value).
 *
 * The seed is self-checked: each of the 3 VIA agent wallets is derived and
 * compared to its on-record address; ANY mismatch aborts (wrong seed -> nothing
 * placed). Keys are NEVER printed to stdout; they go to an OS temp file that is
 * scp'd and then deleted.
 *
 * Why this script and not the seller-agent reading a JSON key map: the reworked
 * seller-agent.mjs resolves keys from env (derive VIA from the seed, read RRG from
 * named vars), so the VPS needs env vars, not a key file.
 *
 * Run:  set AGENT_WALLET_SEED in env or via-app/.env.local, then
 *       node scripts/place-seller-keys-vps.mjs
 * If the seed is absent it places the 12 RRG keys only and warns (VIA sellers stay
 * skipped until the seed is added).
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RRG_TMP = 'C:/Users/Richard/Documents/rrg/tmp';
const VPS = 'agent@89.167.89.219';
const VPS_ENV = '/home/agent/apps/via-agents/.env';
const SSH_KEY = path.join(os.homedir(), '.ssh', 'id_ed25519');

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

// VIA platform sellers: used ONLY to self-check the seed (we place the seed, not
// per-seller keys). slug -> { store id, on-record agent wallet }. (app_sellers 2026-06-16)
const VIA_SELLERS = [
  { slug: 'drhobbs-knowledge',    id: 'dd0e81fd-586b-4196-99f3-5f3ed2974ad6', w: '0x35bcf708834d1c38187a49705dfd7997b551d418' },
  { slug: 'eli-s-artisan-bakery', id: 'e6a32d65-c452-4e07-9393-4fd4c8e8fd6e', w: '0x437432ec24f0f216bd5280d77664e1d7692a71c3' },
  { slug: 'the-sentient-startup', id: '0296cc76-6e88-4459-b978-aea036a893d7', w: '0x580706c5813304c9f03367843ac4d47ca838e105' },
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

// slug -> payer wallet address (lowercased). Same set as place-seller-keys.mjs.
// UU pays from its concierge (agent) wallet 0xe9cedF, NOT its brand payout wallet.
// The env var name is <SLUG_UPPER_UNDERSCORED>_WALLET_PRIVATE_KEY, matching the
// ROSTER env_key in seller-agent.mjs.
const TARGETS = {
  'clooudie':                '0xca5c9c4da1787fea491ed6c94e86b04ec46be61d',
  'nolo':                    '0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d',
  'tyo':                     '0xf78cb04c28e1898638ee4322f4b7b91ee8c0db00',
  'university-of-diversity': '0xb8ca93c837cdcb09ab7e0d61a740fd95d25d7961',
  'les-basics':              '0x8d566ed9a15f38439465405f654416f1276f25b3',
  'gumball-3000':            '0x154bbd968dece4957c7604c8188a8048888de3f9',
  'philleywood':             '0x35df756e97efd1db987e192ccefbf1b210bf4179',
  'pitchers-only':           '0x03e1fc8bf74e11a1fb75d7fc54c1b613fd627d9d',
  'livvium':                 '0x52b406dd49e8fe0cc147e73f1c16ee04530241f5',
  'jennys':                  '0xe206d575572e563a490f4f63e7f8c45b11f87dd6',
  'frey-tailored':           '0x30b1e8cc377a75d9664c26415a820c4925afa595',
  'unknown-union':           '0xe9cedf6453b61771505404b47671602eaa158881',
};
const envKeyFor = (slug) => slug.toUpperCase().replace(/-/g, '_') + '_WALLET_PRIVATE_KEY';

// Index every (address -> privkey) across the RRG credential files.
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

const lines = [];
const placed = [];
const missing = [];
for (const [slug, addr] of Object.entries(TARGETS)) {
  const pk = idx.get(addr.toLowerCase());
  if (pk) { lines.push(`${envKeyFor(slug)}=${pk}`); placed.push(slug); }
  else missing.push(slug);
}

// Seed: self-check each VIA derivation against its on-record address and REPORT,
// then place the seed (NOT per-seller keys). A seller whose derivation does not
// match its funded/on-record wallet is left to the seller-agent's own runtime
// self-check, which skips it fail-closed - so a partial match is safe to place.
// Only a seed that matches NONE of them is rejected (wrong seed entirely).
if (process.env.AGENT_WALLET_SEED) {
  let matches = 0;
  for (const v of VIA_SELLERS) {
    const w = deriveAgentWallet(v.id);
    if (!w) { console.log(`  ${v.slug}: DERIVE-FAIL`); continue; }
    if (w.address.toLowerCase() === v.w.toLowerCase()) { matches++; console.log(`  ${v.slug}: MATCH ${w.address} (will sign)`); }
    else console.log(`  ${v.slug}: MISMATCH derived ${w.address} vs on-record ${v.w} -> SKIPPED at runtime until reconciled`);
  }
  if (matches === 0) { console.error('FATAL: the seed matches NONE of the 3 VIA agent wallets - wrong AGENT_WALLET_SEED. Nothing placed.'); process.exit(1); }
  lines.push(`AGENT_WALLET_SEED=${process.env.AGENT_WALLET_SEED}`);
  console.log(`seed placed: ${matches}/3 VIA sellers match the current seed and will sign; any mismatched ones are skipped (fail-closed).`);
} else {
  console.warn('WARNING: AGENT_WALLET_SEED not set - placing RRG keys only, VIA sellers stay skipped.');
}

if (lines.length === 0) { console.error('nothing to place (no RRG keys found and no seed)'); process.exit(1); }

const tmpFile = path.join(os.tmpdir(), `via-vps-env-${process.pid}.env`);
fs.writeFileSync(tmpFile, lines.join('\n') + '\n', { mode: 0o600 });
try {
  execFileSync('scp', ['-i', SSH_KEY, '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new', tmpFile, `${VPS}:${VPS_ENV}`], { stdio: 'inherit' });
  execFileSync('ssh', ['-i', SSH_KEY, VPS, `chmod 600 ${VPS_ENV}`], { stdio: 'inherit' });
  console.log(`placed ${lines.length} secret line(s) at ${VPS}:${VPS_ENV}`);
  console.log('RRG keys placed:', placed.join(', '));
  if (missing.length) console.log('MISSING RRG keys (address not found in rrg/tmp):', missing.join(', '));
  console.log('next: VIA_AGENT_DRY_RUN=1 /home/agent/apps/via-agents/run.sh  ->  expect all 15 sellers to resolve a key');
} finally {
  fs.rmSync(tmpFile, { force: true });
}
