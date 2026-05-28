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

export type SellerRole = 'admin' | 'viewer';

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

/**
 * All sellers owned by a user. via-app uses a 1:1 owner per seller row
 * (app_sellers.owner_user_id) — there is no separate members table like
 * RRG's app_seller_members. Role is always 'admin' for the owner.
 */
export async function getUserBrands(userId: string): Promise<SellerMembership[]> {
  const { data, error } = await db
    .from('app_sellers')
    .select('id, name, slug')
    .eq('owner_user_id', userId)
    .eq('active', true);

  if (error || !data) return [];

  return data.map((row) => ({
    sellerId:   row.id as string,
    sellerName: row.name as string,
    sellerSlug: row.slug as string,
    role:       'admin' as SellerRole,
  }));
}

/**
 * True iff the user is the owner of this seller row. Name kept as
 * `isBrandAdmin` to avoid call-site churn across the auth + API routes
 * during the brand→seller rename. Semantically: "owns the row".
 */
export async function isBrandAdmin(userId: string, sellerId: string): Promise<boolean> {
  const { data } = await db
    .from('app_sellers')
    .select('id')
    .eq('id', sellerId)
    .eq('owner_user_id', userId)
    .maybeSingle();

  return !!data;
}

/**
 * Middleware helper: require brand admin auth for a route.
 * Returns the authenticated user or a 401 response.
 */
export async function requireBrandAuth(
  sellerId: string,
): Promise<{ user: SellerUser } | { error: NextResponse }> {
  const user = await getSellerUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const isAdmin = await isBrandAdmin(user.id, sellerId);
  if (!isAdmin) {
    return { error: NextResponse.json({ error: 'Not authorized for this brand' }, { status: 403 }) };
  }

  return { user };
}
