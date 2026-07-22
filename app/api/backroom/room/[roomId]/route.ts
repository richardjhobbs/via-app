/**
 * The Room, for the human UI: one call that returns everything the room view
 * needs , table objects (with signed file URLs), warmth, members, the caller's
 * founder flag, and the chat , so the client makes a single request on load
 * instead of three. Members only (owner session + membership), or a superadmin
 * for read-only oversight.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { loadRoom, listTable, roomWarmth, listRoomMembers, listChat } from '@/lib/app/backroom/rooms';
import { listRoomOffers } from '@/lib/app/backroom/offers';
import { publishedCardSlugsFor } from '@/lib/app/backroom/taste-cards';
import { requireRoomMember, type RoomMemberAuth } from '@/lib/app/backroom/ui-auth';
import { isAdminFromCookies } from '@/lib/app/auth';
import { markRoomSeen } from '@/lib/app/backroom/notifications';
import { DIGITAL_BUCKET } from '@/lib/app/digital-delivery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const handle = new URL(req.url).searchParams.get('handle')?.trim() ?? '';

  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  // Auth runs alongside the data fetch so the request is one round-trip deep,
  // not a chain. Data is fetched optimistically and only returned if auth passes.
  const [objects, warmth, members, chat, offers, auth, isAdmin] = await Promise.all([
    listTable(roomId),
    roomWarmth(roomId),
    listRoomMembers(roomId),
    listChat(roomId),
    listRoomOffers(roomId),
    handle ? requireRoomMember(handle, roomId) : Promise.resolve<RoomMemberAuth | null>(null),
    handle ? Promise.resolve(false) : isAdminFromCookies(),
  ]);

  if (handle) {
    if (!auth || !auth.ok) {
      const status = auth && !auth.ok ? auth.status : 401;
      const error = auth && !auth.ok ? auth.error : 'not authenticated';
      return NextResponse.json({ error }, { status });
    }
  } else if (!isAdmin) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 });
  }

  // Founder flag from the members already fetched , no extra query.
  const me = auth && auth.ok ? auth.member : null;

  // The signed-in buyer's own agent wallet, so the offer card can silently
  // auto-connect it (BuyerWalletAutoConnect) and present Buy as a confirm
  // rather than a wallet-connect. Only for a VIA buyer acting as themselves.
  let youWallet: string | null = null;
  let youName: string | null = null;
  if (me && me.member_platform === 'via' && me.member_type === 'buyer') {
    const { data: b } = await db
      .from('app_buyers')
      .select('wallet_address, display_name')
      .ilike('handle', me.member_ref)
      .maybeSingle();
    youWallet = (b as { wallet_address: string | null } | null)?.wallet_address ?? null;
    youName = (b as { display_name: string | null } | null)?.display_name ?? null;
  }
  const youAreFounder = !!(me && members.some(
    (m) => m.member_platform === me.member_platform && m.member_type === me.member_type
      && m.member_ref.toLowerCase() === me.member_ref.toLowerCase() && m.is_founder,
  ));

  // Opening the room clears its pulse for this member.
  if (me) await markRoomSeen(roomId, me);

  // Batch-sign file/image URLs in one storage call, mapping by INDEX (the batch
  // return path is URL-encoded, so a key with a space would never match by path).
  const signPaths = objects.map((o) => o.storage_path).filter((p): p is string => !!p);
  const urlByPath = new Map<string, string>();
  if (signPaths.length > 0) {
    const { data } = await db.storage.from(DIGITAL_BUCKET).createSignedUrls(signPaths, 3600);
    (data ?? []).forEach((d, i) => { if (d?.signedUrl) urlByPath.set(signPaths[i], d.signedUrl); });
  }
  const withUrls = objects.map((o) => ({ ...o, url: o.storage_path ? urlByPath.get(o.storage_path) ?? null : null }));

  // Published taste-card slugs for the member chips, one batched query. Cards
  // link OUT of the room only; a card never mentions rooms.
  const cardSlugs = await publishedCardSlugsFor(members);
  const membersWithCards = members.map((m) => ({
    ...m,
    card_slug: cardSlugs.get(`${m.member_platform}/${m.member_type}/${m.member_ref}`) ?? null,
  }));

  return NextResponse.json({
    room: { id: room.id, name: room.name, accent_hex: room.accent_hex, member_cap: room.member_cap, banner_url: room.banner_url },
    warmth,
    count: withUrls.length,
    objects: withUrls,
    members: membersWithCards,
    you_are_founder: youAreFounder,
    is_admin: !handle && isAdmin,
    chat,
    offers,
    you_wallet: youWallet,
    you_name: youName,
  });
}
