/**
 * One-shot: copy NEXT_PUBLIC_THIRDWEB_CLIENT_ID from the linked RRG Vercel
 * project (where it is stored as Plaintext) into via-app's production env.
 *
 * Same pattern as extract-deepseek.mjs.
 */
import { spawnSync } from 'node:child_process';

const RRG_DIR     = 'C:\\Users\\Richard\\Documents\\rrg';
const VIA_APP_DIR = 'C:\\Users\\Richard\\Documents\\via-app';

process.chdir(RRG_DIR);
const dump = spawnSync(
  'vercel',
  ['env', 'run', '--environment=production', '--', 'node', '-p', 'process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID||""'],
  { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
const out = (dump.stdout || '').replace(/\r/g, '').trim();
const lines = out.split('\n').filter(Boolean);
const key = lines[lines.length - 1] || '';
if (!key || key.length < 8) {
  console.error('FAIL: no thirdweb client ID extracted.');
  console.error('stdout:', out.slice(0, 200));
  process.exit(1);
}
console.error(`Extracted NEXT_PUBLIC_THIRDWEB_CLIENT_ID: length=${key.length}, first 6 chars=${key.slice(0, 6)}…`);

process.chdir(VIA_APP_DIR);
const env = 'production';
spawnSync('vercel', ['env', 'rm', 'NEXT_PUBLIC_THIRDWEB_CLIENT_ID', env, '--yes'], {
  stdio: ['ignore', 'pipe', 'pipe'], shell: true,
});
const r = spawnSync('vercel', ['env', 'add', 'NEXT_PUBLIC_THIRDWEB_CLIENT_ID', env, '--force'], {
  input: key, stdio: ['pipe', 'pipe', 'pipe'], shell: true,
});
console.error(`${r.status === 0 ? 'OK  ' : 'FAIL'} NEXT_PUBLIC_THIRDWEB_CLIENT_ID -> ${env}`);
