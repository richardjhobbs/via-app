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
import { loadRoom, joinRoom, resolveViaMemberWallet, type MemberPlatform, type MemberType } from '@/lib/app/backroom/rooms';
import { resolveRrgBrand, resolveRrgConcierge } from '@/lib/app/backroom/rrg-federation';
import { sendRoomMemberAddedEmail } from '@/lib/app/email';
import { supabaseAdmin } from '@/lib/app/seller-auth';

// Owner email for a seated VIA member, so the heads-up can reach a human: a
// seller's contact email (or owner account), or a buyer owner's account email.
async function resolveViaOwnerEmail(kind: MemberType, ref: string): Promise<string | null> {
  try {
    if (kind === 'seller') {
      const { data } = await db.from('app_sellers').select('contact_email, owner_user_id').eq('slug', ref).maybeSingle();
      const row = data as { contact_email: string | null; owner_user_id: string | null } | null;
      if (row?.contact_email) return row.contact_email;
      if (row?.owner_user_id) { const { data: u } = await supabaseAdmin.auth.admin.getUserById(row.owner_user_id); return u?.user?.email ?? null; }
      return null;
    }
    const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', ref).maybeSingle();
    const id = (data as { owner_user_id: string | null } | null)?.owner_user_id;
    if (!id) return null;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
    return u?.user?.email ?? null;
  } catch {
    return null;
  }
}

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

// Detect whether a VIA ref is a buying agent (handle) or a seller agent (slug),
// so the caller does not have to pick the kind correctly for VIA members.
async function resolveViaKind(ref: string): Promise<MemberType | null> {
  const { data: buyer } = await db.from('app_buyers').select('id').eq('handle', ref).maybeSingle();
  if (buyer) return 'buyer';
  const { data: seller } = await db.from('app_sellers').select('id').eq('slug', ref).maybeSingle();
  if (seller) return 'seller';
  return null;
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
  let conciergeOwnerEmail: string | null = null;
  let effectiveKind: MemberType = kind;

  if (platform === 'via') {
    // The passed kind is only a hint for VIA: detect the real one from the ref so
    // a buyer/seller mismatch does not read as "no such member".
    const detected = await resolveViaKind(ref);
    if (!detected) return NextResponse.json({ error: 'no such VIA member' }, { status: 404 });
    effectiveKind = detected;
    // wallet resolved locally inside joinRoom
  } else {
    // rrg: seller = brand concierge, buyer = personal concierge. Both are
    // FEDERATED (never mirrored): resolve name + wallet from RRG over HTTP, or
    // accept a supplied wallet, then cache it and seat. This lets the operator
    // seat a concierge with no owner action, mirroring how brands are seated.
    // (Personal concierges can still separately IMPORT as a native via/buyer via
    // the owner handoff; that path is unchanged and gives them a VIA login.)
    if (kind === 'seller') {
      const identity = await resolveRrgBrand(ref);
      if (identity) { resolvedName = identity.name; wallet = wallet ?? identity.wallet_address; }
    } else {
      const identity = await resolveRrgConcierge(ref);
      if (identity) { resolvedName = identity.name; wallet = wallet ?? identity.wallet_address; conciergeOwnerEmail = identity.email; }
    }
    if (!wallet) {
      return NextResponse.json({
        error: `RRG did not expose this ${kind === 'seller' ? 'brand' : 'concierge'} wallet; pass the wallet to seat the member (or wait for the RRG identity endpoint).`,
        ref, name: resolvedName,
      }, { status: 422 });
    }
  }

  const isFounder = body.is_founder === true;
  // The operator seating a member IS an authoritative vouch. Without this, a
  // non-founder add returns needs_vouch and nothing is seated (the form has no
  // vouch field). Founders carry no vouch. An explicit vouched_by still wins.
  const vouchedBy = body.vouched_by?.trim() || (isFounder ? null : 'operator');

  // A concierge (rrg/buyer) is seated under its NAME, so its owner's Back Room
  // handoff session matches the membership. Brands keep the slug; VIA keeps ref.
  const seatRef = (platform === 'rrg' && effectiveKind === 'buyer' && resolvedName) ? resolvedName : ref;

  const result = await joinRoom(
    roomId,
    { member_platform: platform, member_type: effectiveKind, member_ref: seatRef },
    vouchedBy,
    isFounder,
    wallet,
  );

  // Surface who was actually seated: resolve a VIA member's cached wallet and
  // display name for the response so it does not read back as null on success.
  if ((result.outcome === 'joined' || result.outcome === 'already') && platform === 'via') {
    wallet = wallet ?? (await resolveViaMemberWallet(effectiveKind, ref));
    if (!resolvedName) {
      if (effectiveKind === 'buyer') {
        const { data } = await db.from('app_buyers').select('display_name').eq('handle', ref).maybeSingle();
        resolvedName = (data as { display_name: string | null } | null)?.display_name ?? null;
      } else {
        const { data } = await db.from('app_sellers').select('name').eq('slug', ref).maybeSingle();
        resolvedName = (data as { name: string | null } | null)?.name ?? null;
      }
    }
  }

  // Courtesy heads-up to the seated member's owner (not a permission gate).
  // Best-effort: a mail failure must not fail the seating. Covers VIA buyers and
  // sellers and RRG personal concierges; RRG brand email is not federated yet.
  let notified = false;
  if (result.outcome === 'joined' || result.outcome === 'already') {
    const ownerEmail = conciergeOwnerEmail ?? (platform === 'via' ? await resolveViaOwnerEmail(effectiveKind, ref) : null);
    if (ownerEmail) {
      try {
        await sendRoomMemberAddedEmail({ to: ownerEmail, roomName: room.name, memberName: resolvedName });
        notified = true;
      } catch (e) { console.warn('[room-members] heads-up email failed:', e); }
    }
  }

  return NextResponse.json({
    outcome: result.outcome,
    member: { platform, kind: effectiveKind, ref: seatRef, name: resolvedName, wallet, vouched_by: isFounder ? null : vouchedBy },
    owner_notified: notified,
  });
}
