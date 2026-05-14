import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export function isAdmin(req?: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  // Check cookie (browser sessions)
  const cookieStore = req
    ? req.cookies.get('admin_token')?.value
    : undefined;

  // For route handlers we use next/headers
  return cookieStore === secret;
}

export async function isAdminFromCookies(): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const cookieStore = await cookies();
  return cookieStore.get('admin_token')?.value === secret;
}

// Read-only admin gate for VIA agents (Priscilla #37750, Sasha #38520, Rosie
// #37751). Accepts the full-admin paths first, then falls back to the
// x-admin-readonly-secret header. Caller must apply this to GET handlers only;
// writes stay locked to isAdminFromCookies / x-admin-secret.
export async function isAdminReader(req: Request): Promise<boolean> {
  if (await isAdminFromCookies()) return true;
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  if (adminSecret && adminHeader && adminHeader === adminSecret) return true;
  const readSecret = process.env.ADMIN_READONLY_SECRET;
  const readHeader = req.headers.get('x-admin-readonly-secret');
  return !!(readSecret && readHeader && readHeader === readSecret);
}

export function adminUnauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
