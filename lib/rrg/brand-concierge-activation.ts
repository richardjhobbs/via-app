/**
 * Brand Concierge activation. Single source of truth.
 *
 * "Activating" a brand concierge means giving the brand owner/operator a
 * login that can reach /brand/[slug]/admin (the concierge tab). Concretely:
 * a Supabase auth user + an rrg_brand_members admin row for the brand. The
 * concierge admin chat and per-brand memory are gated on exactly that row
 * (see lib/rrg/brand-auth.ts isBrandAdmin).
 *
 * This used to exist only inside the manual super-admin invite route. It is
 * now shared by:
 *   - app/api/rrg/admin/brands/invite/route.ts   (manual invite)
 *   - lib/rrg/brand-live-event.ts onBrandLive()  (automatic at Stage-2 live)
 *
 * Idempotent: if the brand already has an admin member, it no-ops and sends
 * no email. Safe to call repeatedly (onBrandLive re-fires, backfill loops).
 */

import { db } from './db';
import { supabaseAdmin } from './brand-auth';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');
const RESEND_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'deliver@realrealgenuine.com';

export type ActivationStatus =
  | 'activated'        // new/updated login + membership created, welcome email sent
  | 'already_active'   // brand already had an admin member, no-op
  | 'skipped'          // no admin email resolvable
  | 'failed';

export interface ActivationResult {
  status: ActivationStatus;
  brandId: string;
  email: string | null;
  userId?: string;
  emailed?: boolean;
  error?: string;
}

interface ActivateInput {
  brandId: string;
  /** Explicit admin email. Falls back to rrg_brands.contact_email. */
  email?: string | null;
  /** Explicit password (manual invite path). Otherwise one is generated. */
  password?: string;
}

function generateTempPassword(): string {
  // URL-safe, 18 chars, well above the 8-char floor the invite route enforced.
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return 'Rg-' + Buffer.from(bytes).toString('base64').replace(/[+/=]/g, '').slice(0, 15);
}

function welcomeEmailHtml(brandName: string, email: string, tempPassword: string): string {
  const loginUrl = `${SITE_URL}/brand/login`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #d4ff22; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #0a0a0a; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .meta { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .meta-row { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #222; }
  .meta-row:last-child { border-bottom: none; }
  .meta-label { color: #888; }
  .meta-value { color: #e5e5e5; font-weight: 500; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin-top: 8px; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Welcome to RRG, ${brandName}</h1></div>
  <div class="body">
    <p>Your ${brandName} storefront is live on RRG, and your Brand Concierge is now ready. Log in to chat with it and lock in events, promotions, stock notes, and policies your customers will see.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Email: </span><span class="meta-value">${email}</span></div>
      <div class="meta-row"><span class="meta-label">Temporary password: </span><span class="meta-value">${tempPassword}</span></div>
    </div>
    <p>Please log in and change your password immediately.</p>
    <a class="btn" href="${loginUrl}">Open your dashboard</a>
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">RRG, Real Real Genuine</a></div>
</div>
</body>
</html>`;
}

/**
 * Ensure the brand has an owner/operator admin login. Idempotent.
 */
export async function activateBrandConcierge(input: ActivateInput): Promise<ActivationResult> {
  const { brandId } = input;

  const { data: brand, error: brandErr } = await db
    .from('rrg_brands')
    .select('id, name, slug, contact_email')
    .eq('id', brandId)
    .maybeSingle();

  if (brandErr || !brand) {
    return { status: 'failed', brandId, email: null, error: brandErr?.message ?? 'brand not found' };
  }

  const email = (input.email ?? (brand.contact_email as string | null) ?? '').trim().toLowerCase();
  if (!email) {
    return { status: 'skipped', brandId, email: null, error: 'no admin email on brand' };
  }

  // Idempotency: already has an admin member -> no-op, no email.
  const { data: existingMember } = await db
    .from('rrg_brand_members')
    .select('id')
    .eq('brand_id', brandId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (existingMember) {
    return { status: 'already_active', brandId, email, emailed: false };
  }

  const tempPassword = input.password ?? generateTempPassword();

  // Create or find the auth user, then make sure the emailed password works.
  let userId: string;
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createErr) {
    if (createErr.message.includes('already been registered') || createErr.message.includes('already exists')) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
      if (!existing) {
        return { status: 'failed', brandId, email, error: 'user exists but could not be located' };
      }
      userId = existing.id;
      // Set the temp password so the credential we email actually works.
      await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword });
    } else {
      return { status: 'failed', brandId, email, error: createErr.message };
    }
  } else {
    userId = created.user.id;
  }

  const { error: memberErr } = await db
    .from('rrg_brand_members')
    .upsert({ brand_id: brandId, user_id: userId, role: 'admin' }, { onConflict: 'brand_id,user_id' });

  if (memberErr) {
    return { status: 'failed', brandId, email, userId, error: memberErr.message };
  }

  // Welcome email (best-effort; membership already committed).
  let emailed = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject: `Your ${brand.name as string} Brand Concierge is live on RRG`,
          html: welcomeEmailHtml(brand.name as string, email, tempPassword),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      emailed = res.ok;
    } catch {
      emailed = false;
    }
  }

  return { status: 'activated', brandId, email, userId, emailed };
}
