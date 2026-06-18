/**
 * scripts/place-vps-keys.mjs
 *
 * Cutover helper: place the RRG brand payer keys into the VPS env so the reworked
 * seller agent can pay for every roster brand. Reads each key from the RRG
 * credential files by wallet address, writes <SLUG>_WALLET_PRIVATE_KEY lines, and
 * appends only the ones not already present to /home/agent/apps/rrg/.env.local on
 * the VPS. Key VALUES are never printed; only slug names are logged.
 */
import { ethers } from 'ethers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const RRG_TMP = 'C:/Users/Richard/Documents/rrg/tmp';
const VPS = 'agent@89.167.89.219';
const ENV_FILE = '/home/agent/apps/rrg/.env.local';

// slug -> payer wallet (UU pays from its concierge wallet 0xe9cedf, not the brand wallet).
const TARGETS = {
  'clooudie':                '0xca5c9c4da1787fea491ed6c94e86b04ec46be61d',
  'nolo':                    '0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d',
  'jennys':                  '0xe206d575572e563a490f4f63e7f8c45b11f87dd6',
  'unknown-union':           '0xe9cedf6453b61771505404b47671602eaa158881',
  'les-basics':              '0x8d566ed9a15f38439465405f654416f1276f25b3',
  'frey-tailored':           '0x30b1e8cc377a75d9664c26415a820c4925afa595',
  'livvium':                 '0x52b406dd49e8fe0cc147e73f1c16ee04530241f5',
  'pitchers-only':           '0x03e1fc8bf74e11a1fb75d7fc54c1b613fd627d9d',
};

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
for (const [slug, w] of Object.entries(TARGETS)) {
  const pk = idx.get(w.toLowerCase());
  const envKey = slug.toUpperCase().replace(/-/g, '_') + '_WALLET_PRIVATE_KEY';
  if (pk) { lines.push(`${envKey}=${pk}`); placed.push(slug); } else missing.push(slug);
}

// AGENT_WALLET_SEED (activates the 3 VIA sellers) , pulled from via-app Vercel
// prod, appended only if not already on the VPS. Value never printed.
let seed = null;
try {
  const seedTmp = path.join(os.tmpdir(), `seed-${process.pid}.env`);
  execSync(`vercel env pull "${seedTmp}" --environment=production --yes`, { stdio: 'ignore' });
  for (const ln of fs.readFileSync(seedTmp, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = ln.match(/^AGENT_WALLET_SEED=(.*)$/);
    if (m) seed = m[1].trim().replace(/^["']|["']$/g, '');
  }
  fs.rmSync(seedTmp, { force: true });
} catch (e) { console.log('seed pull failed (place RRG keys only):', e.message); }

const tmp = path.join(os.tmpdir(), `vpskeys-${process.pid}.env`);
fs.writeFileSync(tmp, lines.join('\n') + '\n' + (seed ? `AGENT_WALLET_SEED=${seed}\n` : ''));
try {
  execFileSync('scp', ['-o', 'StrictHostKeyChecking=accept-new', tmp, `${VPS}:/tmp/vpskeys.env`], { stdio: 'inherit' });
  // Append only keys whose var name is not already present (idempotent).
  const remote = `while IFS= read -r line; do k="\${line%%=*}"; [ -n "$k" ] && (grep -q "^\${k}=" ${ENV_FILE} || echo "$line" >> ${ENV_FILE}); done < /tmp/vpskeys.env; rm -f /tmp/vpskeys.env; echo "VPS RRG keys present:"; grep -oE "^[A-Z0-9_]*WALLET_PRIVATE_KEY" ${ENV_FILE} | sort -u; grep -q "^AGENT_WALLET_SEED=" ${ENV_FILE} && echo "AGENT_WALLET_SEED: present" || echo "AGENT_WALLET_SEED: MISSING"`;
  execFileSync('ssh', [VPS, remote], { stdio: 'inherit' });
} finally {
  fs.rmSync(tmp, { force: true });
}
console.log('placed slugs:', placed.join(', '));
if (missing.length) console.log('MISSING creds for:', missing.join(', '));
