/**
 * One-off operator script: enable the demo VIA seller agents end to end.
 * Mints an admin_token from ADMIN_SECRET (.env.local) and POSTs the
 * /api/admin/sellers/<id>/enable-agent route for each store. Prints only the
 * JSON responses (never the secret/token).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';

const env = {};
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SECRET = env.ADMIN_SECRET;
if (!SECRET) { console.error('ADMIN_SECRET not in .env.local'); process.exit(1); }

const BASE = process.env.BASE || 'https://app.getvia.xyz';
const nonce = crypto.randomBytes(32).toString('hex');
const exp = String(Date.now() + 1000 * 60 * 10);
const sig = crypto.createHmac('sha256', SECRET).update(`${nonce}.${exp}`).digest('hex');
const token = `${nonce}.${exp}.${sig}`;

const STORES = [
  { slug: 'dear-vinyl',    id: '617374b8-3724-49cd-9f93-2340926df960' },
  { slug: 'recycle-vinyl', id: '5d48521a-5bd2-4d0c-aab0-cfb885106fe9' },
  { slug: 'snow-records',  id: '7518f06d-1c46-4afb-a009-e0841272d81e' },
  { slug: 'vinyleers',     id: 'f227563f-cac5-45c8-8f66-92466b19a9f8' },
];

for (const s of STORES) {
  try {
    const res = await fetch(`${BASE}/api/admin/sellers/${s.id}/enable-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `admin_token=${token}` },
    });
    const body = await res.text();
    console.log(`\n=== ${s.slug} (${res.status}) ===`);
    console.log(body);
  } catch (e) {
    console.log(`\n=== ${s.slug} ERROR ===`);
    console.log(e instanceof Error ? e.message : String(e));
  }
}
