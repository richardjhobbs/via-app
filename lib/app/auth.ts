import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

export function isAdmin(req?: NextRequest): boolean {
  if (!process.env.ADMIN_SECRET) return false;
  // Browser sessions present a derived admin_token cookie (see issueAdminToken).
  const token = req ? req.cookies.get('admin_token')?.value : undefined;
  return verifyAdminToken(token);
}

export async function isAdminFromCookies(): Promise<boolean> {
  if (!process.env.ADMIN_SECRET) return false;
  const cookieStore = await cookies();
  return verifyAdminToken(cookieStore.get('admin_token')?.value);
}

// ── Admin session cookie ──────────────────────────────────────────────
// The cookie carries a derived, expiring token, never the raw ADMIN_SECRET.
// Format: `${nonce}.${exp}.${sig}` where sig = HMAC-SHA256(ADMIN_SECRET,
// `${nonce}.${exp}`). A leaked cookie therefore cannot be replayed as the
// x-admin-secret bearer (it does not contain the master secret), and every
// token self-expires. Verified with a constant-time comparison.
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, matches cookie maxAge

function adminTokenSig(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function issueAdminToken(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error('ADMIN_SECRET not configured');
  const nonce = crypto.randomBytes(32).toString('hex');
  const exp   = String(Date.now() + ADMIN_TOKEN_TTL_MS);
  return `${nonce}.${exp}.${adminTokenSig(`${nonce}.${exp}`, secret)}`;
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [nonce, exp, sig] = parts;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return false;
  return timingSafeEqual(sig, adminTokenSig(`${nonce}.${exp}`, secret));
}

// Read-only admin gate for VIA agents (Priscilla #37750, Sasha #38520, Rosie
// #37751). Accepts the full-admin paths first, then falls back to the
// x-admin-readonly-secret header. Caller must apply this to GET handlers only;
// writes stay locked to isAdminFromCookies / x-admin-secret.
export async function isAdminReader(req: Request): Promise<boolean> {
  if (await isAdminFromCookies()) return true;
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  if (adminSecret && adminHeader && timingSafeEqual(adminHeader, adminSecret)) return true;
  const readSecret = process.env.ADMIN_READONLY_SECRET;
  const readHeader = req.headers.get('x-admin-readonly-secret');
  return !!(readSecret && readHeader && timingSafeEqual(readHeader, readSecret));
}

export function adminUnauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Per-brand concierge key, bound to ONE slug. Derived (not stored): the server
// recomputes it from the server-only CONCIERGE_KEY_SECRET, so a concierge can
// be provisioned with a key that only validates for its own brand. Returns
// null if CONCIERGE_KEY_SECRET is unset (then only the superadmin path works,
// a safe default that never widens access).
export function conciergeKeyFor(slug: string): string | null {
  const root = process.env.CONCIERGE_KEY_SECRET;
  if (!root) return null;
  return crypto
    .createHmac('sha256', root)
    .update(slug.trim().toLowerCase())
    .digest('hex');
}

// Authorisation for the per-brand concierge API. Two principals only:
//   - RRG superadmin: full ADMIN_SECRET or the admin cookie, spans all brands.
//   - The brand's own concierge: x-concierge-secret == conciergeKeyFor(slug),
//     which is cryptographically bound to THIS slug, so brand A's concierge
//     cannot read brand B by changing the path. ADMIN_READONLY_SECRET is
//     deliberately NOT accepted here (customer PII is more sensitive than the
//     /brands /drops read surface that header was minted for).
export async function isConciergeAuthorized(req: Request, slug: string): Promise<boolean> {
  if (await isAdminFromCookies()) return true;
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  if (adminSecret && adminHeader && timingSafeEqual(adminHeader, adminSecret)) return true;
  const expected = conciergeKeyFor(slug);
  const provided = req.headers.get('x-concierge-secret');
  if (expected && provided && timingSafeEqual(provided, expected)) return true;
  return false;
}
