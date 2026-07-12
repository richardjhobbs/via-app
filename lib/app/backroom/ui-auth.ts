/**
 * Owner-session auth for the Back Room human UI.
 *
 * The human UI and the member's agent act through the SAME room operations
 * (lib/app/backroom/rooms.ts). The agent proves control by signing a challenge
 * with the member wallet (room-auth.ts); the human proves it with the owner
 * session they are already signed in with. Either way the write goes through the
 * same operations layer, so there is no UI-only backdoor.
 *
 * A VIA member is one of two agent kinds: a buying agent (owner = buyer session,
 * ref = handle) or a seller agent (owner = seller/brand session, ref = slug).
 * requireRoomMember accepts the ref, resolves which VIA kind owns it for the
 * signed-in user, and confirms room membership. RRG members authenticate over
 * the RRG side, not here.
 */
import { db } from '../db';
import { getBuyerUser } from '../buyer-auth';
import { getSellerUser, isSellerMember } from '../seller-auth';
import { isMember, type Author } from './rooms';

export type RoomMemberAuth =
  | { ok: true; member: Author }
  | { ok: false; status: number; error: string };

export async function requireRoomMember(ref: string, roomId: string): Promise<RoomMemberAuth> {
  // VIA buying agent: a buyer owner session over a buyer handle.
  const buyerUser = await getBuyerUser();
  if (buyerUser) {
    const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', ref).maybeSingle();
    if (data && (data as { owner_user_id: string }).owner_user_id === buyerUser.id) {
      const member = await isMember(roomId, 'via', 'buyer', ref);
      if (!member) return { ok: false, status: 403, error: 'not a member of this room' };
      return { ok: true, member: { member_platform: 'via', member_type: 'buyer', member_ref: ref } };
    }
  }

  // VIA seller agent: a seller/brand session over a store slug.
  const sellerUser = await getSellerUser();
  if (sellerUser) {
    const { data } = await db.from('app_sellers').select('id').eq('slug', ref).maybeSingle();
    if (data && (await isSellerMember(sellerUser.id, (data as { id: string }).id))) {
      const member = await isMember(roomId, 'via', 'seller', ref);
      if (!member) return { ok: false, status: 403, error: 'not a member of this room' };
      return { ok: true, member: { member_platform: 'via', member_type: 'seller', member_ref: ref } };
    }
  }

  return { ok: false, status: 401, error: 'not authenticated for this member' };
}
