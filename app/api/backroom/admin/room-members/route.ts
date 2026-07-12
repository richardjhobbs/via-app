/**
 * Admin: add a member (any of the four kinds) to a room.
 *
 * POST { room_id, platform, kind, ref, wallet?, vouched_by?, is_founder? }
 *   via/buyer  = VIA buying agent  (ref = handle)   , wallet resolved locally
 *   via/seller = VIA seller agent  (ref = slug)      , wallet resolved locally
 *   rrg/seller = RRG brand concierge (ref = slug)    , identity + wallet fetched
 *                over federation; if RRG does not expose the wallet, pass it.
 *   rrg/buyer  = RRG personal concierge: not added here. It imports into VIA as
 *                a buying agent via the handoff and is then a native via/buyer.
 *
 * Superadmin only.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isAdminFromCookies } from '@/lib/app/auth';
import { db } from '@/lib/app/db';
import { loadRoom, joinRoom, type MemberPlatform, type MemberType } from '@/lib/app/backroom/rooms';
import { resolveRrgBrand } from '@/lib/app/backroom/rrg-federation';

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

async function viaRefExists(kind: MemberType, ref: string): Promise<boolean> {
  const table = kind === 'buyer' ? 'app_buyers' : 'app_sellers';
  const col = kind === 'buyer' ? 'handle' : 'slug';
  const { data } = await db.from(table).select('id').eq(col, ref).maybeSingle();
  return !!data;
}

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { room_id?: string; platform?: string; kind?: string; ref?: string; wallet?: string; vouched_by?: string; is_founder?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const roomId = body.room_id?.trim() ?? '';
  const platform = body.platform as MemberPlatform;
  const kind = body.kind as MemberType;
  const ref = body.ref?.trim() ?? '';
  if (!roomId || !ref) return NextResponse.json({ error: 'room_id and ref required' }, { status: 400 });
  if (platform !== 'via' && platform !== 'rrg') return NextResponse.json({ error: "platform must be 'via' or 'rrg'" }, { status: 400 });
  if (kind !== 'buyer' && kind !== 'seller') return NextResponse.json({ error: "kind must be 'buyer' or 'seller'" }, { status: 400 });

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let wallet: string | null = body.wallet?.trim() || null;
  let resolvedName: string | null = null;

  if (platform === 'via') {
    if (!(await viaRefExists(kind, ref))) return NextResponse.json({ error: 'no such VIA member' }, { status: 404 });
    // wallet resolved locally inside joinRoom
  } else {
    // rrg
    if (kind !== 'seller') {
      return NextResponse.json({ error: 'RRG personal concierges join by importing into VIA as a buying agent (handoff), not here' }, { status: 400 });
    }
    const identity = await resolveRrgBrand(ref);
    if (!identity) return NextResponse.json({ error: 'could not resolve RRG brand over federation' }, { status: 404 });
    resolvedName = identity.name;
    wallet = wallet ?? identity.wallet_address;
    if (!wallet) {
      return NextResponse.json({
        error: 'RRG does not expose this brand wallet yet; pass wallet explicitly to add the member',
        brand: { ref, name: identity.name, mcp_url: identity.mcp_url },
      }, { status: 422 });
    }
  }

  const result = await joinRoom(
    roomId,
    { member_platform: platform, member_type: kind, member_ref: ref },
    body.vouched_by?.trim() || null,
    body.is_founder === true,
    wallet,
  );

  return NextResponse.json({ outcome: result.outcome, member: { platform, kind, ref, name: resolvedName, wallet } });
}
