/**
 * scripts/setup-vps-ci-secrets.mjs
 *
 * One-time: set the three GitHub Actions secrets the agent-deploy workflow needs
 * to scp seller-agent.mjs to the VPS from CI (so deploys never require a manual
 * scp from a workstation). Secrets: VPS_HOST, VPS_USER, VPS_SSH_KEY.
 *
 * Token is read from the local git credential store (the same one that pushes
 * this repo). Secret values are encrypted client-side with libsodium sealed
 * boxes (GitHub's required format) and are NEVER printed.
 *
 * Usage: node scripts/setup-vps-ci-secrets.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import _sodium from 'libsodium-wrappers';

const REPO = 'richardjhobbs/via-app';
const KEY_PATH = path.join(os.homedir(), '.ssh', 'id_ed25519');

const SECRETS = {
  VPS_HOST: '89.167.89.219',
  VPS_USER: 'agent',
  VPS_SSH_KEY: readFileSync(KEY_PATH, 'utf8'),
};

function token() {
  const out = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\npath=' + REPO + '.git\n\n',
  }).toString();
  const m = out.match(/password=(.*)/);
  if (!m) throw new Error('no token in git credential store');
  return m[1].trim();
}

function api(method, p, tok, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: 'api.github.com', path: p, method,
      headers: {
        'User-Agent': 'via-deploy', Authorization: 'Bearer ' + tok,
        Accept: 'application/vnd.github+json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  await _sodium.ready;
  const sodium = _sodium;
  const tok = token();

  const pk = await api('GET', `/repos/${REPO}/actions/secrets/public-key`, tok);
  if (pk.status !== 200) { console.error('public-key fetch failed', pk.status, pk.body.slice(0, 200)); process.exit(1); }
  const { key, key_id } = JSON.parse(pk.body);
  const keyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);

  for (const [name, value] of Object.entries(SECRETS)) {
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
    const encrypted_value = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
    const res = await api('PUT', `/repos/${REPO}/actions/secrets/${name}`, tok, { encrypted_value, key_id });
    console.log(`${name}: ${res.status === 201 ? 'created' : res.status === 204 ? 'updated' : 'FAILED ' + res.status + ' ' + res.body.slice(0, 120)}`);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
