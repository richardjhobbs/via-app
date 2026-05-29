/**
 * Buyer admin authentication via Supabase Auth (email/password).
 *
 * Mirror of lib/app/seller-auth.ts. Buyers authenticate with the same
 * sb-access-token / sb-refresh-token cookies (shared Supabase project),
 * scoped to the app_buyers table via owner_user_id.
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from './db';

// ── Supabase client for auth operations (anon key, token verification) ──
const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-key',
);

// ── Types ───────────────────────────────────────────────────────────────

export interface BuyerUser {
  id: string;
  email: string;
}

export interface BuyerMembership {
  buyerId: string;
  handle: string;
  displayName: string;
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

export function setBuyerAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, COOKIE_OPTIONS);
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, COOKIE_OPTIONS);
}

export function clearBuyerAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}

// ── Auth helpers ────────────────────────────────────────────────────────

/**
 * Read the buyer user from cookies. Returns null if not authenticated.
 */
export async function getBuyerUser(): Promise<BuyerUser | null> {
  const cookieStore = await cookies();
  const accessToken  = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessToken) return null;

  const { data, error } = await supabaseAuth.auth.getUser(accessToken);

  if (error || !data.user) {
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
 * All buyer profiles owned by a user. One owner can hold multiple handles;
 * the login flow uses the first.
 */
export async function getUserBuyers(userId: string): Promise<BuyerMembership[]> {
  const { data, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name')
    .eq('owner_user_id', userId);

  if (error || !data) return [];

  return data.map((row) => ({
    buyerId:     row.id as string,
    handle:      row.handle as string,
    displayName: (row.display_name as string | null) ?? (row.handle as string),
  }));
}

/**
 * True iff the user owns this buyer row.
 */
export async function isBuyerOwner(userId: string, buyerId: string): Promise<boolean> {
  const { data } = await db
    .from('app_buyers')
    .select('id')
    .eq('id', buyerId)
    .eq('owner_user_id', userId)
    .maybeSingle();

  return !!data;
}

/**
 * Middleware helper: require buyer auth for a route. Returns the
 * authenticated user or a NextResponse error.
 */
export async function requireBuyerAuth(
  buyerId: string,
): Promise<{ user: BuyerUser } | { error: NextResponse }> {
  const user = await getBuyerUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const owns = await isBuyerOwner(user.id, buyerId);
  if (!owns) {
    return { error: NextResponse.json({ error: 'Not authorized for this buyer' }, { status: 403 }) };
  }

  return { user };
}
