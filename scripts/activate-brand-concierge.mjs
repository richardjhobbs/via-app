/**
 * scripts/activate-brand-concierge.mjs
 *
 * Give a brand owner the login that makes their Brand Concierge reachable:
 * a Supabase auth user + an rrg_brand_members admin row, plus a welcome
 * email. This is the .mjs sibling of lib/rrg/brand-concierge-activation.ts
 * (kept behaviourally identical) so the script-driven Stage-2 path
 * (confirm-brand.mjs) activates the concierge the same way the server path
 * (onBrandLive) does.
 *
 *   node scripts/activate-brand-concierge.mjs --slug <slug> [--email <e>] [--dry-run]
 *   node scripts/activate-brand-concierge.mjs --all-transaction-ready [--dry-run]
 *
 * Idempotent: brands that already have an admin member are skipped, no
 * email sent. --all-transaction-ready loops every active brand with >=1
 * live listing and a real wallet that has no admin member yet (the backfill).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── .env.local (best-effort; ambient env also accepted so this runs from
//    a git worktree where .env.local lives in the main checkout) ───────
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch { /* no local file; rely on ambient env, validated below */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'deliver@realrealgenuine.com';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');
const SHARED_MIRROR_WALLET = '0x734a25fb869ab6415b78bbe9a39f1f99dab349e7';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const SLUG = flag('--slug');
const EMAIL_OVERRIDE = flag('--email');
const ALL = args.includes('--all-transaction-ready');
const DRY_RUN = args.includes('--dry-run');

if (!SLUG && !ALL) {
  console.error('Usage: --slug <slug> [--email <e>] [--dry-run]  |  --all-transaction-ready [--dry-run]');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function tempPassword() {
  return 'Rg-' + Buffer.from(crypto.getRandomValues(new Uint8Array(14)))
    .toString('base64').replace(/[+/=]/g, '').slice(0, 15);
}

function welcomeHtml(brandName, email, pw) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e5e5e5;padding:40px 20px">
<div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;overflow:hidden">
<div style="background:#d4ff22;padding:24px 28px"><h1 style="margin:0;font-size:20px;color:#0a0a0a">Welcome to RRG, ${brandName}</h1></div>
<div style="padding:28px;color:#ccc;font-size:14px;line-height:1.6">
<p>Your ${brandName} storefront is live on RRG and your Brand Concierge is ready. Log in to chat with it and lock in events, promotions, stock notes, and policies your customers will see.</p>
<div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin:20px 0">
<div style="padding:6px 0;font-size:13px">Email: <strong style="color:#e5e5e5">${email}</strong></div>
<div style="padding:6px 0;font-size:13px">Temporary password: <strong style="color:#e5e5e5">${pw}</strong></div></div>
<p>Please log in and change your password immediately.</p>
<a href="${SITE_URL}/brand/login" style="display:inline-block;background:#d4ff22;color:#0a0a0a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a>
</div></div></body></html>`;
}

async function activate(brand) {
  const email = (EMAIL_OVERRIDE || brand.contact_email || '').trim().toLowerCase();
  if (!email) return { slug: brand.slug, status: 'skipped', reason: 'no contact_email' };

  const { data: member } = await db
    .from('rrg_brand_members')
    .select('id').eq('brand_id', brand.id).eq('role', 'admin').limit(1).maybeSingle();
  if (member) return { slug: brand.slug, status: 'already_active', email };

  if (DRY_RUN) return { slug: brand.slug, status: 'would_activate', email };

  const pw = tempPassword();
  let userId;
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email, password: pw, email_confirm: true,
  });
  if (cErr) {
    if (/already (been )?registered|already exists/i.test(cErr.message)) {
      const { data: list } = await db.auth.admin.listUsers();
      const ex = list?.users?.find((u) => u.email?.toLowerCase() === email);
      if (!ex) return { slug: brand.slug, status: 'failed', email, reason: 'user exists, not found' };
      userId = ex.id;
      await db.auth.admin.updateUserById(userId, { password: pw });
    } else {
      return { slug: brand.slug, status: 'failed', email, reason: cErr.message };
    }
  } else {
    userId = created.user.id;
  }

  const { error: mErr } = await db
    .from('rrg_brand_members')
    .upsert({ brand_id: brand.id, user_id: userId, role: 'admin' }, { onConflict: 'brand_id,user_id' });
  if (mErr) return { slug: brand.slug, status: 'failed', email, userId, reason: mErr.message };

  let emailed = false;
  if (RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL, to: email,
          subject: `Your ${brand.name} Brand Concierge is live on RRG`,
          html: welcomeHtml(brand.name, email, pw),
        }),
      });
      emailed = r.ok;
    } catch { emailed = false; }
  }
  return { slug: brand.slug, status: 'activated', email, userId, emailed };
}

(async () => {
  let brands;
  if (ALL) {
    const { data, error } = await db
      .from('rrg_brands')
      .select('id, slug, name, status, contact_email, wallet_address')
      .eq('status', 'active');
    if (error) { console.error('FATAL:', error.message); process.exit(1); }
    // Filter to transaction-ready: real wallet (not zero) + >=1 live listing.
    brands = [];
    for (const b of data) {
      if (!b.wallet_address || /^0x0+$/i.test(b.wallet_address) || b.wallet_address.length !== 42) continue;
      const { count } = await db
        .from('rrg_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', b.id).eq('status', 'approved').eq('hidden', false)
        .not('token_id', 'is', null).not('price_usdc', 'is', null);
      if ((count ?? 0) >= 1) brands.push(b);
    }
    void SHARED_MIRROR_WALLET; // shared-wallet brands still qualify (payout works)
  } else {
    const { data, error } = await db
      .from('rrg_brands')
      .select('id, slug, name, status, contact_email, wallet_address')
      .eq('slug', SLUG).maybeSingle();
    if (error || !data) { console.error(`FATAL: brand "${SLUG}" not found`); process.exit(1); }
    brands = [data];
  }

  console.log(`activate-brand-concierge: ${brands.length} brand(s)${DRY_RUN ? ' [DRY RUN]' : ''}`);
  for (const b of brands) {
    const res = await activate(b);
    console.log(JSON.stringify(res));
  }
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
