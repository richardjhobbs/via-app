/**
 * Seller team management: members + pending invites.
 *
 * Access for a seller is decided by app_seller_members (owner/admin/viewer).
 * app_seller_invites holds invitations for people who don't have a via-app
 * account yet; accepting one creates/links the account and adds a member row.
 *
 * All queries use the service-role `db` client (RLS is bypassed); the caller is
 * responsible for having checked the actor's role first (see requireBrandAuth).
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { db } from './db';
import { supabaseAdmin } from './seller-auth';
import { sendSellerInviteEmail } from './email';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.getvia.xyz';

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

export type AssignableRole = 'admin' | 'viewer';

export interface TeamMember {
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'viewer';
  acceptedAt: string | null;
  isOwner: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: AssignableRole;
  createdAt: string;
  expiresAt: string;
}

// ── Read ──────────────────────────────────────────────────────────────

/** Members (with resolved emails) + pending invites for a seller. */
export async function listTeam(sellerId: string): Promise<{
  members: TeamMember[];
  invites: PendingInvite[];
}> {
  const [membersRes, invitesRes] = await Promise.all([
    db.from('app_seller_members')
      .select('user_id, role, accepted_at')
      .eq('seller_id', sellerId)
      .order('role', { ascending: true }),
    db.from('app_seller_invites')
      .select('id, email, role, created_at, expires_at')
      .eq('seller_id', sellerId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  const rows = membersRes.data ?? [];
  const members: TeamMember[] = await Promise.all(
    rows.map(async (r) => {
      let email = '';
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id as string);
        email = data.user?.email ?? '';
      } catch { /* leave blank if the auth lookup fails */ }
      return {
        userId:     r.user_id as string,
        email,
        role:       r.role as TeamMember['role'],
        acceptedAt: (r.accepted_at as string | null) ?? null,
        isOwner:    r.role === 'owner',
      };
    }),
  );

  const invites: PendingInvite[] = (invitesRes.data ?? [])
    .filter((i) => new Date(i.expires_at as string).getTime() > Date.now())
    .map((i) => ({
      id:        i.id as string,
      email:     i.email as string,
      role:      i.role as AssignableRole,
      createdAt: i.created_at as string,
      expiresAt: i.expires_at as string,
    }));

  return { members, invites };
}

/**
 * Emails of the people who run a store: the owner plus every accepted admin.
 * Used to notify the account of orders that need manual fulfilment. Deduped and
 * lower-cased; viewers and pending (unaccepted) invites are excluded.
 */
export async function listAdminEmails(sellerId: string): Promise<string[]> {
  const { members } = await listTeam(sellerId);
  const emails = members
    .filter((m) => m.role === 'owner' || (m.role === 'admin' && m.acceptedAt))
    .map((m) => m.email.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  return Array.from(new Set(emails));
}

// ── Invite ────────────────────────────────────────────────────────────

/** Find an existing auth user by email (case-insensitive). Null if none. */
async function findUserByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  // supabase-js admin has no get-by-email; page through the user list.
  for (let page = 1; page <= 20; page++) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (users.length < 200) break;
  }
  return null;
}

/**
 * Invite an email to a seller. If the email already has a via-app account it is
 * linked immediately (membership created, accepted). Otherwise a pending invite
 * row is created and an email with an accept link is sent.
 */
export async function inviteToSeller(opts: {
  sellerId: string;
  sellerName: string;
  sellerSlug: string;
  email: string;
  role: AssignableRole;
  // null when initiated by the superadmin (no auth.users identity).
  invitedBy: string | null;
  inviterEmail: string | null;
}): Promise<{ ok: true; linked: boolean } | { ok: false; error: string; status: number }> {
  const email = opts.email.trim().toLowerCase();
  if (!email.includes('@')) return { ok: false, error: 'Valid email required', status: 400 };
  if (opts.role !== 'admin' && opts.role !== 'viewer')
    return { ok: false, error: 'Role must be admin or viewer', status: 400 };

  const existingUserId = await findUserByEmail(email);

  if (existingUserId) {
    // Already has an account — link membership immediately.
    const { data: prior } = await db
      .from('app_seller_members')
      .select('id, role')
      .eq('seller_id', opts.sellerId)
      .eq('user_id', existingUserId)
      .maybeSingle();

    if (prior) {
      if (prior.role === 'owner')
        return { ok: false, error: 'That person is the owner of this store', status: 409 };
      return { ok: false, error: 'That person is already on the team', status: 409 };
    }

    const { error } = await db.from('app_seller_members').insert({
      seller_id:   opts.sellerId,
      user_id:     existingUserId,
      role:        opts.role,
      invited_by:  opts.invitedBy,
      accepted_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: 'Could not add member', status: 500 };
    return { ok: true, linked: true };
  }

  // No account yet — create/refresh a pending invite and email an accept link.
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await db
    .from('app_seller_invites')
    .upsert(
      {
        seller_id:  opts.sellerId,
        email,
        role:       opts.role,
        token,
        invited_by: opts.invitedBy,
        expires_at: expiresAt,
        accepted_at: null,
      },
      { onConflict: 'seller_id,email' },
    );
  if (error) return { ok: false, error: 'Could not create invite', status: 500 };

  try {
    await sendSellerInviteEmail({
      to:           email,
      sellerName:   opts.sellerName,
      inviterEmail: opts.inviterEmail,
      role:         opts.role,
      acceptUrl:    `${SITE_URL}/seller/invite/${token}`,
      expiresAt,
    });
  } catch (e) {
    console.error('[seller-team] invite email failed', e);
    return { ok: false, error: 'Invite saved but email failed to send', status: 502 };
  }

  return { ok: true, linked: false };
}

/** Revoke a pending invite. */
export async function revokeInvite(sellerId: string, inviteId: string): Promise<boolean> {
  const { error } = await db
    .from('app_seller_invites')
    .delete()
    .eq('id', inviteId)
    .eq('seller_id', sellerId)
    .is('accepted_at', null);
  return !error;
}

// ── Membership changes ──────────────────────────────────────────────────

/** Change a member's role. The owner row cannot be changed. */
export async function changeMemberRole(
  sellerId: string,
  userId: string,
  role: AssignableRole,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (role !== 'admin' && role !== 'viewer')
    return { ok: false, error: 'Role must be admin or viewer', status: 400 };

  const { data: target } = await db
    .from('app_seller_members')
    .select('role')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!target) return { ok: false, error: 'Member not found', status: 404 };
  if (target.role === 'owner')
    return { ok: false, error: 'The owner role cannot be changed', status: 409 };

  const { error } = await db
    .from('app_seller_members')
    .update({ role })
    .eq('seller_id', sellerId)
    .eq('user_id', userId);
  if (error) return { ok: false, error: 'Could not update role', status: 500 };
  return { ok: true };
}

/** Remove a member. The owner row cannot be removed. */
export async function removeMember(
  sellerId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: target } = await db
    .from('app_seller_members')
    .select('role')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!target) return { ok: false, error: 'Member not found', status: 404 };
  if (target.role === 'owner')
    return { ok: false, error: 'The owner cannot be removed', status: 409 };

  const { error } = await db
    .from('app_seller_members')
    .delete()
    .eq('seller_id', sellerId)
    .eq('user_id', userId);
  if (error) return { ok: false, error: 'Could not remove member', status: 500 };
  return { ok: true };
}

// ── Accept ──────────────────────────────────────────────────────────────

export interface InviteDetails {
  sellerId: string;
  sellerName: string;
  sellerSlug: string;
  email: string;
  role: AssignableRole;
  needsAccount: boolean;
}

/** Look up a pending invite by token. Returns null if missing/expired/accepted. */
export async function getInviteByToken(token: string): Promise<InviteDetails | null> {
  const { data: invite } = await db
    .from('app_seller_invites')
    .select('seller_id, email, role, expires_at, accepted_at, seller:seller_id ( name, slug )')
    .eq('token', token)
    .maybeSingle();

  if (!invite) return null;
  if (invite.accepted_at) return null;
  if (new Date(invite.expires_at as string).getTime() <= Date.now()) return null;

  const s = (Array.isArray(invite.seller) ? invite.seller[0] : invite.seller) as
    | { name: string; slug: string }
    | undefined;
  if (!s) return null;

  const needsAccount = (await findUserByEmail(invite.email as string)) === null;

  return {
    sellerId:   invite.seller_id as string,
    sellerName: s.name,
    sellerSlug: s.slug,
    email:      invite.email as string,
    role:       invite.role as AssignableRole,
    needsAccount,
  };
}

/**
 * Accept an invite. Creates the account if needed (using `password`), or signs
 * in an existing account, then adds the membership row and marks the invite
 * accepted. Returns Supabase session tokens so the caller can set cookies.
 */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<
  | { ok: true; sellerSlug: string; accessToken: string; refreshToken: string }
  | { ok: false; error: string; status: number }
> {
  const { data: invite } = await db
    .from('app_seller_invites')
    .select('id, seller_id, email, role, expires_at, accepted_at, seller:seller_id ( slug )')
    .eq('token', token)
    .maybeSingle();

  if (!invite || invite.accepted_at)
    return { ok: false, error: 'This invitation is no longer valid', status: 410 };
  if (new Date(invite.expires_at as string).getTime() <= Date.now())
    return { ok: false, error: 'This invitation has expired', status: 410 };
  if (!password || password.length < 8)
    return { ok: false, error: 'Password must be 8+ characters', status: 400 };

  const email   = invite.email as string;
  const s       = (Array.isArray(invite.seller) ? invite.seller[0] : invite.seller) as { slug: string } | undefined;
  const slug    = s?.slug ?? '';
  let   userId  = await findUserByEmail(email);

  if (!userId) {
    // New account: create it auto-confirmed with the chosen password.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: 'via_app_seller_invite' },
    });
    if (createErr || !created.user)
      return { ok: false, error: 'Could not create your account', status: 500 };
    userId = created.user.id;
  }

  // Sign in to mint a session (verifies the password for existing accounts too).
  const { data: signIn, error: signInErr } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session)
    return { ok: false, error: 'Incorrect password for this email. Sign in with your existing password.', status: 401 };

  // Add (or upgrade) the membership.
  const { error: memErr } = await db
    .from('app_seller_members')
    .upsert(
      {
        seller_id:   invite.seller_id,
        user_id:     userId,
        role:        invite.role,
        invited_at:  new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      },
      { onConflict: 'seller_id,user_id' },
    );
  if (memErr) return { ok: false, error: 'Could not add you to the team', status: 500 };

  await db.from('app_seller_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return {
    ok: true,
    sellerSlug:   slug,
    accessToken:  signIn.session.access_token,
    refreshToken: signIn.session.refresh_token,
  };
}
