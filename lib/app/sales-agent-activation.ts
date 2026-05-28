/**
 * Brand Concierge activation. Single source of truth.
 *
 * "Activating" a brand concierge means giving the brand owner/operator a
 * login that can reach /brand/[slug]/admin (the concierge tab). Concretely:
 * a Supabase auth user + an app_seller_members admin row for the brand. The
 * concierge admin chat and per-brand memory are gated on exactly that row
 * (see lib/app/seller-auth.ts isBrandAdmin).
 *
 * This used to exist only inside the manual super-admin invite route. It is
 * now shared by:
 *   - app/api/rrg/admin/brands/invite/route.ts   (manual invite)
 *   - lib/app/brand-live-event.ts onBrandLive()  (automatic at Stage-2 live)
 *
 * Idempotent: if the brand already has an admin member, it no-ops and sends
 * no email. Safe to call repeatedly (onBrandLive re-fires, backfill loops).
 */

import { db } from './db';
import { supabaseAdmin } from './brand-auth';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');
const RESEND_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'deliver@realrealgenuine.com';

// A brand may have up to this many admins. The contact_email admin that
// Stage-2 auto-activation creates counts as one of these.
const MAX_BRAND_ADMINS = 3;

export type ActivationStatus =
  | 'activated'        // login + membership ensured, welcome email sent
  | 'already_active'   // this invitee is already an admin, no-op (no email)
  | 'skipped'          // no admin email resolvable, or admin cap reached
  | 'failed';

export interface ActivationResult {
  status: ActivationStatus;
  sellerId: string;
  email: string | null;
  userId?: string;
  emailed?: boolean;
  error?: string;
}

interface ActivateInput {
  sellerId: string;
  /** Explicit admin email. Falls back to app_sellers.contact_email. */
  email?: string | null;
  /** Explicit password (manual invite path). Otherwise one is generated. */
  password?: string;
  /**
   * Manual super-admin invite. When true, an existing admin is re-invited
   * (password reset + welcome email re-sent) instead of no-opping, and a
   * new invitee is added as long as the brand is under MAX_BRAND_ADMINS.
   * The automatic Stage-2 path leaves this unset to stay idempotent.
   */
  reinvite?: boolean;
}

function generateTempPassword(): string {
  // URL-safe, 18 chars, well above the 8-char floor the invite route enforced.
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return 'Rg-' + Buffer.from(bytes).toString('base64').replace(/[+/=]/g, '').slice(0, 15);
}

function welcomeEmailHtml(sellerName: string, email: string, tempPassword: string): string {
  const loginUrl = `${SITE_URL}/brand/login`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .meta { width: 100%; border: 1px solid #e8e3db; border-collapse: collapse; margin: 0 0 24px; }
  .meta td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #e8e3db; }
  .meta tr:last-child td { border-bottom: none; }
  .meta-label { color: #6e665c; white-space: nowrap; padding-right: 16px; }
  .meta-value { color: #1a1612; font-weight: 500; text-align: right; font-family: 'Courier New', Courier, monospace; font-size: 13px; word-break: break-all; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Brand concierge live</p>
      <h1>Welcome to RRG, ${sellerName}</h1>
    </div>
    <div class="body">
      <p>Your ${sellerName} storefront is live on RRG, and your Brand Concierge is now ready. Log in to chat with it and lock in events, promotions, stock notes, and policies your customers will see.</p>
      <p class="lbl">Your sign-in</p>
      <table class="meta" cellpadding="0" cellspacing="0"><tbody>
        <tr><td class="meta-label">Email</td><td class="meta-value">${email}</td></tr>
        <tr><td class="meta-label">Temporary password</td><td class="meta-value">${tempPassword}</td></tr>
      </tbody></table>
      <p>Please log in and change your password immediately.</p>
      <a class="btn" href="${loginUrl}">Open your dashboard</a>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">RRG / Real Real Genuine</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}/rrg" style="color:#6e665c;text-decoration:none;">realrealgenuine.com</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;
}

/**
 * Ensure the brand has an owner/operator admin login. Idempotent.
 */
export async function activateSalesAgent(input: ActivateInput): Promise<ActivationResult> {
  const { sellerId } = input;

  const { data: brand, error: brandErr } = await db
    .from('app_sellers')
    .select('id, name, slug, contact_email')
    .eq('id', sellerId)
    .maybeSingle();

  if (brandErr || !brand) {
    return { status: 'failed', sellerId, email: null, error: brandErr?.message ?? 'brand not found' };
  }

  const email = (input.email ?? (brand.contact_email as string | null) ?? '').trim().toLowerCase();
  if (!email) {
    return { status: 'skipped', sellerId, email: null, error: 'no admin email on brand' };
  }

  // Resolve the invitee's auth user (may not exist yet).
  let userId: string | null = null;
  {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    userId = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  }

  // Current admin roster for this brand.
  const { data: adminRows, error: adminErr } = await db
    .from('app_seller_members')
    .select('user_id')
    .eq('brand_id', sellerId)
    .eq('role', 'admin');

  if (adminErr) {
    return { status: 'failed', sellerId, email, error: adminErr.message };
  }

  const adminUserIds = (adminRows ?? []).map((r) => r.user_id as string);
  const inviteeIsAdmin = userId != null && adminUserIds.includes(userId);

  // Automatic Stage-2 path stays idempotent: if this invitee is already an
  // admin and we are not explicitly re-inviting, no-op (no email). The
  // manual super-admin route passes reinvite:true to force a fresh password
  // and re-send the welcome email even for an existing admin.
  if (inviteeIsAdmin && !input.reinvite) {
    return { status: 'already_active', sellerId, email, userId: userId ?? undefined, emailed: false };
  }

  // Per-brand admin cap. The Stage-2 contact_email admin counts as one.
  // Re-inviting someone who is already an admin does not consume a slot.
  if (!inviteeIsAdmin && adminUserIds.length >= MAX_BRAND_ADMINS) {
    return {
      status: 'skipped',
      sellerId,
      email,
      error: `brand already has the maximum of ${MAX_BRAND_ADMINS} admins`,
    };
  }

  const tempPassword = input.password ?? generateTempPassword();

  // Ensure an auth user exists with the credential we are about to email.
  if (userId == null) {
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
          return { status: 'failed', sellerId, email, error: 'user exists but could not be located' };
        }
        userId = existing.id;
        await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword });
      } else {
        return { status: 'failed', sellerId, email, error: createErr.message };
      }
    } else {
      userId = created.user.id;
    }
  } else {
    // Existing auth user: reset to the credential we are about to email.
    await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword });
  }

  if (userId == null) {
    return { status: 'failed', sellerId, email, error: 'could not resolve auth user' };
  }

  const { error: memberErr } = await db
    .from('app_seller_members')
    .upsert({ brand_id: sellerId, user_id: userId, role: 'admin' }, { onConflict: 'brand_id,user_id' });

  if (memberErr) {
    return { status: 'failed', sellerId, email, userId, error: memberErr.message };
  }

  // Signal that this brand needs a Hermes Brand Concierge provisioned on the
  // Box. NULL -> 'pending' only, so backfilled / already-provisioned brands
  // are not downgraded and failed states stay sticky for manual review. The
  // operator-side processor (scripts/process-pending-concierges.ps1) picks
  // 'pending' rows up, runs provision-concierge.ps1 + cutover-concierges.sh
  // for that slug, then marks 'provisioned'. Best-effort: the admin login
  // path is the load-bearing Stage-2 step; a flag-set failure does not abort
  // the activation.
  await db
    .from('app_sellers')
    .update({ hermes_concierge_status: 'pending' })
    .eq('id', sellerId)
    .is('hermes_concierge_status', null);

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

  return { status: 'activated', sellerId, email, userId, emailed };
}
