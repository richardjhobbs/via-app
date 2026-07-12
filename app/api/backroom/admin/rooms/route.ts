/**
 * Admin: create a Back Room and (optionally) seat its founding members.
 *
 * The room is given its platform-derived agent wallet on creation (createRoom),
 * so its identity and future settlement wallet exist before any payment is
 * wired. Founders are seated through the cap/vouch RPC with is_founder=true
 * (founders carry no vouched_by; the room grows from them by vouching).
 * Superadmin only.
 *
 * POST { name, accent_hex?, created_from?, founders?: string[] }
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isAdminFromCookies } from '@/lib/app/auth';
import { db } from '@/lib/app/db';
import { createRoom, joinRoom } from '@/lib/app/backroom/rooms';

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

  let body: { name?: string; accent_hex?: string; created_from?: string; founders?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const room = await createRoom({ name, accent_hex: body.accent_hex, created_from: body.created_from });

  const seated: Record<string, string> = {};
  for (const handle of body.founders ?? []) {
    const h = handle.trim();
    if (!h) continue;
    if (!(await buyerExists(h))) { seated[h] = 'no_such_member'; continue; }
    const res = await joinRoom(room.id, { member_platform: 'via', member_type: 'buyer', member_ref: h }, null, true);
    seated[h] = res.outcome;
  }

  return NextResponse.json({
    room: { id: room.id, name: room.name, accent_hex: room.accent_hex, agent_wallet_address: room.agent_wallet_address },
    founders: seated,
  }, { status: 201 });
}
