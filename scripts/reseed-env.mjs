/**
 * reseed-env.mjs — Re-push via-app env vars to Vercel without BOM contamination.
 *
 * The previous PowerShell-based push wrote the staging file with `Set-Content
 * -Encoding utf8`, which prepends a UTF-8 BOM (EF BB BF). When values were
 * piped through `vercel env add` from that file, the BOM landed in the value
 * itself — e.g. NEXT_PUBLIC_SUPABASE_URL came back as "﻿https://..."
 * which the Supabase client rejected with "supabaseUrl is required".
 *
 * Node's child_process pipes byte-for-byte without BOM, so this script
 * removes each affected env then re-adds it with a clean value.
 *
 * Source: via-labs-website/.vercel/.env-snapshot + rrg/.env.local + constants.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SNAPSHOT_VIA_LABS = 'C:\\Users\\Richard\\Documents\\via-labs-website\\.vercel\\.env-snapshot';
const RRG_LOCAL         = 'C:\\Users\\Richard\\Documents\\rrg\\.env.local';

function parseEnv(path) {
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    // strip BOM if present on the very first char
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    // Also strip any BOM that crept into the value itself.
    v = v.replace(/^﻿/, '');
    out[m[1]] = v;
  }
  return out;
}

const viaLabs = parseEnv(SNAPSHOT_VIA_LABS);
const rrg     = parseEnv(RRG_LOCAL);

const env = {
  SUPABASE_URL:                  viaLabs.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY:     viaLabs.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL:      viaLabs.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjeHlvdWp1YnFjbGVucmhoaWxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NzYwMzIsImV4cCI6MjA4NjQ1MjAzMn0.q54LQf643l_dxtLRHhWYyLpvZfrysxJPiqemkGDa-x8',
  DEEPSEEK_API_KEY:              viaLabs.DEEPSEEK_API_KEY,
  VIA_REGISTRAR_PRIVATE_KEY:     viaLabs.VIA_REGISTRAR_PRIVATE_KEY,
  VIA_PLATFORM_SECRETS:          viaLabs.VIA_PLATFORM_SECRETS,
  NEXT_PUBLIC_BASE_RPC_URL:      rrg.NEXT_PUBLIC_BASE_RPC_URL     || 'https://mainnet.base.org',
  BASE_RPC_URL:                  rrg.NEXT_PUBLIC_BASE_RPC_URL     || 'https://mainnet.base.org',
  DEPLOYER_PRIVATE_KEY:          rrg.DEPLOYER_PRIVATE_KEY,
  ADMIN_SECRET:                  rrg.ADMIN_SECRET,
  RESEND_API_KEY:                rrg.RESEND_API_KEY,
  NEXT_PUBLIC_PLATFORM_WALLET:   '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d',
  NEXT_PUBLIC_VIA_CONTRACT_ADDRESS: '0xF8BC7b42697908Af35Df6cb7B687029110b8DF76',
};

const targets = ['production', 'preview'];

for (const [name, value] of Object.entries(env)) {
  if (!value) {
    console.log(`SKIP ${name} (no value)`);
    continue;
  }
  // BOM sanity check before pushing
  if (/^﻿/.test(value)) {
    console.log(`FIXED BOM on ${name}`);
  }
  for (const env_name of targets) {
    // Remove first (force, no prompt). Ignore failure if not present.
    spawnSync('vercel', ['env', 'rm', name, env_name, '--yes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    // Add fresh from a clean Node-controlled stdin (no BOM).
    const r = spawnSync('vercel', ['env', 'add', name, env_name, '--force'], {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    const ok = r.status === 0;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(35)} -> ${env_name}`);
    if (!ok) {
      console.log('     stderr:', String(r.stderr).slice(0, 200));
    }
  }
}

console.log('\nDone. Trigger a redeploy.');
