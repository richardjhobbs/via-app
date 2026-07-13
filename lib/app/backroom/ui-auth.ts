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
 * signed-in user, and confirms room membership.
 *
 * An RRG brand concierge (rrg/seller) is federated, not a VIA account, so it is
 * recognised here through the brand session cookie (brand-session.ts) opened by
 * the RRG handoff. RRG personal concierges (rrg/buyer) are not seen here: they
 * import into VIA as a native via/buyer and are resolved on the buyer path.
 */
import { db } from '../db';
import { getBuyerUser, getUserBuyers } from '../buyer-auth';
import { getSellerUser, isSellerMember, getUserBrands } from '../seller-auth';
import { getBrandSession } from './brand-session';
import { isMember, type Author, type MemberPlatform, type MemberType } from './rooms';

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
  const brand = await getBrandSession();
  if (brand && brand.slug === ref) {
    return { ok: true, member: { member_platform: 'rrg', member_type: 'seller', member_ref: ref } };
  }
  return { ok: false, status: 401, error: 'not authenticated for this member' };
}

export interface SessionMember { platform: MemberPlatform; type: MemberType; ref: string; label: string; }

/**
 * Every VIA member the current session is already signed in as: their buying
 * agent(s) and any seller stores they belong to. This is what lets the Back
 * Room reuse an existing agent-admin session, so a signed-in user never has to
 * log in again to reach a room. Empty when there is no session.
 */
export async function sessionMembers(): Promise<SessionMember[]> {
  const out: SessionMember[] = [];
  const buyerUser = await getBuyerUser();
  if (buyerUser) {
    for (const b of await getUserBuyers(buyerUser.id)) {
      out.push({ platform: 'via', type: 'buyer', ref: b.handle, label: b.displayName || b.handle });
    }
  }
  const sellerUser = await getSellerUser();
  if (sellerUser) {
    for (const s of await getUserBrands(sellerUser.id)) {
      out.push({ platform: 'via', type: 'seller', ref: s.sellerSlug, label: s.sellerName || s.sellerSlug });
    }
  }
  const brand = await getBrandSession();
  if (brand) {
    out.push({ platform: 'rrg', type: 'seller', ref: brand.slug, label: brand.name || brand.slug });
  }
  return out;
}

/** The primary session member (first buyer, else first seller), or null. */
export async function primarySessionMember(): Promise<SessionMember | null> {
  const all = await sessionMembers();
  return all[0] ?? null;
}

/** As resolveOwnedMember, and additionally require active membership of the room. */
export async function requireRoomMember(ref: string, roomId: string): Promise<RoomMemberAuth> {
  const owned = await resolveOwnedMember(ref);
  if (!owned.ok) return owned;
  const member = await isMember(roomId, owned.member.member_platform, owned.member.member_type, owned.member.member_ref);
  if (!member) return { ok: false, status: 403, error: 'not a member of this room' };
  return owned;
}
