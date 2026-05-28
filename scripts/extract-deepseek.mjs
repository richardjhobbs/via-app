/**
 * One-shot: extract DEEPSEEK_API_KEY from the linked RRG Vercel project (where
 * it is stored as Plaintext, so `vercel env run` returns the value), then push
 * it to the via-app Vercel project as production + preview.
 *
 * Required: vercel CLI logged in to the team that owns both projects.
 * Run from the via-app dir; the script cd's to rrg to read, then back to push.
 */
import { spawnSync } from 'node:child_process';

const RRG_DIR     = 'C:\\Users\\Richard\\Documents\\rrg';
const VIA_APP_DIR = 'C:\\Users\\Richard\\Documents\\via-app';

// Step 1: read DEEPSEEK_API_KEY from RRG live env. The cleanest way is to
// dump it via printenv inside vercel env run so we don't fight Windows shell
// quoting. Then grep for the JWT-ish/sk- prefix in stdout.
process.chdir(RRG_DIR);
const dump = spawnSync(
  'vercel',
  ['env', 'run', '--environment=production', '--', 'node', '-p', 'process.env.DEEPSEEK_API_KEY||""'],
  { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
// vercel injects banner lines like "Downloading…" to stderr and the command output to stdout.
const out = (dump.stdout || '').replace(/\r/g, '').trim();
// The last non-empty line is the printed value.
const lines = out.split('\n').filter(Boolean);
const key = lines[lines.length - 1] || '';
if (!key || key.length < 10) {
  console.error('FAIL: no DEEPSEEK key extracted. stdout:', JSON.stringify(out).slice(0, 300));
  console.error('stderr:', (dump.stderr || '').slice(0, 300));
  process.exit(1);
}
console.error(`Extracted DEEPSEEK_API_KEY: length=${key.length}, first 6 chars=${key.slice(0, 6)}...`);

// Step 2: push to via-app for production + preview.
process.chdir(VIA_APP_DIR);
for (const env of ['production', 'preview']) {
  spawnSync('vercel', ['env', 'rm', 'DEEPSEEK_API_KEY', env, '--yes'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  const r = spawnSync('vercel', ['env', 'add', 'DEEPSEEK_API_KEY', env, '--force'], {
    input: key,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
  console.error(`${r.status === 0 ? 'OK  ' : 'FAIL'} DEEPSEEK_API_KEY -> ${env}`);
  if (r.status !== 0) console.error('  stderr:', String(r.stderr).slice(0, 200));
}
