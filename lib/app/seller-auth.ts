/**
 * Brand admin authentication via Supabase Auth (email/password).
 *
 * Completely separate from the super-admin ADMIN_SECRET cookie auth.
 * Brand admins authenticate via sb-access-token / sb-refresh-token cookies.
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from './db';

// ── Supabase client for auth operations (uses anon key for client-side auth) ──
const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-key',
);

// ── Supabase admin client (uses service key for admin user management) ──
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder-key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export { supabaseAdmin };

// ── Types ───────────────────────────────────────────────────────────────

export type SellerRole = 'owner' | 'admin' | 'viewer';

export interface SellerUser {
  id: string;
  email: string;
}

export interface SellerMembership {
  sellerId: string;
  sellerName: string;
  sellerSlug: string;
  role: SellerRole;
}

// ── Cookie management ───────────────────────────────────────────────────

const ACCESS_TOKEN_COOKIE  = 'sb-access-token';
const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

export function setBrandAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, COOKIE_OPTIONS);
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, COOKIE_OPTIONS);
}

export function clearBrandAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}

// ── Auth helpers ────────────────────────────────────────────────────────

/**
 * Read brand user from cookies. Returns null if not authenticated.
 */
export async function getSellerUser(): Promise<SellerUser | null> {
  const cookieStore = await cookies();
  const accessToken  = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessToken) return null;

  // Verify the token by getting the user
  const { data, error } = await supabaseAuth.auth.getUser(accessToken);

  if (error || !data.user) {
    // Try refreshing the token
    if (refreshToken) {
      const { data: refreshData, error: refreshError } =
        await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });

      if (!refreshError && refreshData.user) {
        return {
          id: refreshData.user.id,
          email: refreshData.user.email ?? '',
        };
      }
    }
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email ?? '',
  };
}

// SellerMemberRole is the same set as SellerRole; alias kept for call-site clarity.
export type SellerMemberRole = SellerRole;

// Roles ordered by privilege; used for "at least this role" checks.
const ROLE_RANK: Record<SellerMemberRole, number> = { viewer: 0, admin: 1, owner: 2 };

/** True iff `role` is at least as privileged as `min`. */
export function roleAtLeast(role: SellerMemberRole, min: SellerMemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * All sellers a user belongs to, via app_seller_members. A seller may now have
 * several members (owner / admin / viewer); the membership table is the source
 * of truth for access, while app_sellers.owner_user_id stays as the immutable
 * billing/wallet owner. Returns the user's role on each.
 */
export async function getUserBrands(userId: string): Promise<SellerMembership[]> {
  const { data, error } = await db
    .from('app_seller_members')
    .select('role, seller:seller_id ( id, name, slug, active )')
    .eq('user_id', userId);

  if (error || !data) return [];

  return data
    .map((row) => {
      // PostgREST types the embedded row as an array; it's a single object here.
      const s = (Array.isArray(row.seller) ? row.seller[0] : row.seller) as
        | { id: string; name: string; slug: string; active: boolean }
        | undefined;
      if (!s || s.active === false) return null;
      return {
        sellerId:   s.id,
        sellerName: s.name,
        sellerSlug: s.slug,
        role:       row.role as SellerRole,
      };
    })
    .filter((m): m is SellerMembership => m !== null);
}

/**
 * The user's role on a seller, or null if they are not a member. Single source
 * of truth for every admin-surface gate (replaces the old owner_user_id match).
 */
export async function getSellerRole(
  userId: string,
  sellerId: string,
): Promise<SellerMemberRole | null> {
  const { data } = await db
    .from('app_seller_members')
    .select('role')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .maybeSingle();

  return (data?.role as SellerMemberRole | undefined) ?? null;
}

/** True iff the user is a member (any role) of this seller. */
export async function isSellerMember(userId: string, sellerId: string): Promise<boolean> {
  return (await getSellerRole(userId, sellerId)) !== null;
}

/**
 * True iff the user can manage this seller (owner or admin). Name kept as
 * `isBrandAdmin` to avoid call-site churn. Viewers return false.
 */
export async function isBrandAdmin(userId: string, sellerId: string): Promise<boolean> {
  const role = await getSellerRole(userId, sellerId);
  return role !== null && roleAtLeast(role, 'admin');
}

/**
 * Require an authenticated member of this seller. Any role (incl. viewer)
 * passes by default; pass minRole: 'admin' on write routes so viewers get a
 * 403. Returns the user + their role, or an error response.
 */
export async function requireBrandAuth(
  sellerId: string,
  minRole: SellerMemberRole = 'viewer',
): Promise<{ user: SellerUser; role: SellerMemberRole } | { error: NextResponse }> {
  const user = await getSellerUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const role = await getSellerRole(user.id, sellerId);
  if (!role) {
    return { error: NextResponse.json({ error: 'Not authorized for this brand' }, { status: 403 }) };
  }
  if (!roleAtLeast(role, minRole)) {
    return { error: NextResponse.json({ error: 'Your role does not permit this action' }, { status: 403 }) };
  }

  return { user, role };
}
