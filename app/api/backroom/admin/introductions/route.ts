/**
 * Admin curation for the seed room: propose an introduction between two members.
 *
 * This is the hand-curated stand-in for the taste matcher (which plugs into the
 * same app_introductions state machine later). Superadmin only.
 *
 * POST { a_handle, b_handle, context_pack }
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isAdminFromCookies } from '@/lib/app/auth';
import { db } from '@/lib/app/db';
import { proposeIntroduction } from '@/lib/app/backroom/introductions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function headerSecretOk(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers.get('x-admin-secret');
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function requireAdmin(req: Request): Promise<boolean> {
  return (await isAdminFromCookies()) || headerSecretOk(req);
}

async function buyerExists(handle: string): Promise<boolean> {
  const { data } = await db.from('app_buyers').select('id').eq('handle', handle).maybeSingle();
  return !!data;
}

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { a_handle?: string; b_handle?: string; context_pack?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const aHandle = body.a_handle?.trim();
  const bHandle = body.b_handle?.trim();
  if (!aHandle || !bHandle) return NextResponse.json({ error: 'a_handle and b_handle required' }, { status: 400 });
  if (aHandle === bHandle) return NextResponse.json({ error: 'cannot introduce a member to themselves' }, { status: 400 });

  const [aOk, bOk] = await Promise.all([buyerExists(aHandle), buyerExists(bHandle)]);
  if (!aOk || !bOk) return NextResponse.json({ error: 'both members must exist' }, { status: 404 });

  const result = await proposeIntroduction(
    { member_platform: 'via', member_type: 'buyer', member_ref: aHandle },
    { member_platform: 'via', member_type: 'buyer', member_ref: bHandle },
    body.context_pack ?? {},
  );
  return NextResponse.json(result, { status: result.outcome === 'proposed' ? 201 : 200 });
}
