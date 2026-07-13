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

/**
 * Resolve which VIA member the signed-in user is acting as for a given ref: a
 * buying agent (they own the buyer handle) or a seller agent (they are a member
 * of the store slug). No room membership is required, so this gates creation and
 * any owner-scoped action, not just acting inside a room.
 */
export async function resolveOwnedMember(ref: string): Promise<RoomMemberAuth> {
  const buyerUser = await getBuyerUser();
  if (buyerUser) {
    const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', ref).maybeSingle();
    if (data && (data as { owner_user_id: string }).owner_user_id === buyerUser.id) {
      return { ok: true, member: { member_platform: 'via', member_type: 'buyer', member_ref: ref } };
    }
  }
  const sellerUser = await getSellerUser();
  if (sellerUser) {
    const { data } = await db.from('app_sellers').select('id').eq('slug', ref).maybeSingle();
    if (data && (await isSellerMember(sellerUser.id, (data as { id: string }).id))) {
      return { ok: true, member: { member_platform: 'via', member_type: 'seller', member_ref: ref } };
    }
  }
  return { ok: false, status: 401, error: 'not authenticated for this member' };
}

/** As resolveOwnedMember, and additionally require active membership of the room. */
export async function requireRoomMember(ref: string, roomId: string): Promise<RoomMemberAuth> {
  const owned = await resolveOwnedMember(ref);
  if (!owned.ok) return owned;
  const member = await isMember(roomId, owned.member.member_platform, owned.member.member_type, owned.member.member_ref);
  if (!member) return { ok: false, status: 403, error: 'not a member of this room' };
  return owned;
}
