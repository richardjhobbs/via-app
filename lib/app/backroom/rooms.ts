/**
 * Back Room data layer: the room, its members, and the event-shaped table.
 *
 * app_room_events is the table. Every placement, move, corner assignment, piece
 * of talk, and errand result is one event (kind / author / payload / created_at),
 * shaped like a NOSTR event so the later move to encrypted events on the relay
 * is a transport swap. The current table state is a projection of that log.
 */
import { db } from '../db';
import { deriveAgentWallet } from '../agent-wallet';

// A member is always an agent, of one of four kinds across two platforms:
//   via/buyer  = VIA buying agent       via/seller = VIA seller agent
//   rrg/buyer  = RRG personal concierge rrg/seller = RRG brand concierge
// Identity is the (platform, kind, ref) triple; refs can collide across
// platforms, so platform is always part of the key.
export type MemberPlatform = 'via' | 'rrg';
export type MemberType = 'buyer' | 'seller';

export interface RoomRow {
  id:         string;
  name:       string;
  accent_hex: string;
  created_from: string;
  member_cap: number;
  agent_wallet_address: string | null;
}

export interface RoomMember {
  member_platform: MemberPlatform;
  member_type: MemberType;
  member_ref:  string;
  is_founder:  boolean;
  vouched_by:  string | null;
}

export interface Author { member_platform: MemberPlatform; member_type: MemberType; member_ref: string; }

export type RoomEventKind = 'object_placed' | 'object_moved' | 'corner_assigned' | 'talk' | 'errand_result';

export async function loadRoom(roomId: string): Promise<RoomRow | null> {
  const { data } = await db
    .from('app_rooms')
    .select('id, name, accent_hex, created_from, member_cap, agent_wallet_address')
    .eq('id', roomId)
    .maybeSingle();
  return (data as RoomRow) ?? null;
}

/**
 * Create a room and give it its platform-derived agent wallet. The wallet is
 * derived from AGENT_WALLET_SEED + the new room id AFTER insert (the id does not
 * exist before), then written back. A room is MCP-autonomous, so the runtime
 * must be able to sign for it; that is only possible with a platform-derived
 * wallet, never a human in-app wallet. If the seed is unset the room still
 * exists with a null wallet (payments simply cannot settle until it is set).
 */
export async function createRoom(input: { name: string; accent_hex?: string; created_from?: string; createdBy?: Author }): Promise<RoomRow> {
  const { data, error } = await db
    .from('app_rooms')
    .insert({
      name: input.name,
      accent_hex: input.accent_hex ?? '#8a5a3c',
      created_from: input.created_from ?? 'introduction',
      created_by_platform: input.createdBy?.member_platform ?? null,
      created_by_type: input.createdBy?.member_type ?? null,
      created_by_ref: input.createdBy?.member_ref ?? null,
    })
    .select('id, name, accent_hex, created_from, member_cap, agent_wallet_address')
    .single();
  if (error) throw error;
  const room = data as RoomRow;

  const wallet = deriveAgentWallet(room.id);
  if (wallet) {
    await db.from('app_rooms').update({ agent_wallet_address: wallet.address, updated_at: new Date().toISOString() }).eq('id', room.id);
    room.agent_wallet_address = wallet.address;
  }
  return room;
}

// A guard while creation is democratised but network-wide oversight is not yet
// built: a member may found only so many live rooms. Private by construction
// (there is no room discovery surface), so this is the only creation limit.
export const MAX_ROOMS_PER_FOUNDER = 5;

export type CreateRoomResult =
  | { ok: true; room: RoomRow }
  | { ok: false; reason: 'rate_limited' };

/**
 * Any network agent creates a room: the room is formed, given its wallet, and
 * the creator is seated as a founding member. Rate limited per creator.
 */
export async function createRoomAsMember(
  creator: Author,
  input: { name: string; accent_hex?: string },
  creatorWallet?: string | null,
): Promise<CreateRoomResult> {
  const { count } = await db
    .from('app_rooms')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('created_by_platform', creator.member_platform)
    .eq('created_by_type', creator.member_type)
    .eq('created_by_ref', creator.member_ref);
  if ((count ?? 0) >= MAX_ROOMS_PER_FOUNDER) return { ok: false, reason: 'rate_limited' };

  const room = await createRoom({
    name: input.name,
    accent_hex: input.accent_hex,
    created_from: 'introduction',
    createdBy: creator,
  });
  // VIA members resolve their wallet locally; a federated brand has no local
  // wallet, so its own wallet (from the brand session) must be seated here to
  // keep the by-wallet member lookup uniform.
  await joinRoom(room.id, creator, null, true, creatorWallet);
  return { ok: true, room };
}

/** Backfill a room's platform wallet if it is missing (e.g. seed set after creation). */
export async function ensureRoomWallet(roomId: string): Promise<string | null> {
  const room = await loadRoom(roomId);
  if (!room) return null;
  if (room.agent_wallet_address) return room.agent_wallet_address;
  const wallet = deriveAgentWallet(roomId);
  if (!wallet) return null;
  await db.from('app_rooms').update({ agent_wallet_address: wallet.address, updated_at: new Date().toISOString() }).eq('id', roomId);
  return wallet.address;
}

/**
 * Resolve the room member controlling a given wallet, uniformly across all four
 * kinds, by the wallet cached on the membership row at join. A VIA buying agent
 * holds its own in-app wallet, a VIA seller agent its platform-derived wallet,
 * and an RRG concierge its own RRG wallet: whichever it is, the signer is
 * matched against app_room_members.member_wallet within THIS room.
 */
export async function memberByWallet(roomId: string, wallet: string): Promise<RoomMember | null> {
  const walletLc = wallet.trim().toLowerCase();
  const { data } = await db
    .from('app_room_members')
    .select('member_platform, member_type, member_ref, is_founder, vouched_by')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .ilike('member_wallet', walletLc)
    .maybeSingle();
  return (data as RoomMember) ?? null;
}

/**
 * The wallet a VIA member authenticates with: a buyer's own in-app wallet, a
 * seller's platform-derived agent wallet. Returns null for RRG members (their
 * wallet comes from the RRG side) or when the ref is unknown.
 */
export async function resolveViaMemberWallet(memberType: MemberType, memberRef: string): Promise<string | null> {
  if (memberType === 'buyer') {
    const { data } = await db.from('app_buyers').select('wallet_address').eq('handle', memberRef).maybeSingle();
    return (data as { wallet_address: string | null } | null)?.wallet_address ?? null;
  }
  const { data } = await db.from('app_sellers').select('agent_wallet_address').eq('slug', memberRef).maybeSingle();
  return (data as { agent_wallet_address: string | null } | null)?.agent_wallet_address ?? null;
}

export async function isMember(roomId: string, platform: MemberPlatform, memberType: MemberType, memberRef: string): Promise<RoomMember | null> {
  const { data } = await db
    .from('app_room_members')
    .select('member_platform, member_type, member_ref, is_founder, vouched_by')
    .eq('room_id', roomId)
    .eq('member_platform', platform)
    .eq('member_type', memberType)
    .eq('member_ref', memberRef)
    .eq('status', 'active')
    .maybeSingle();
  return (data as RoomMember) ?? null;
}

/** True if the given member is a founder of the room (an active founding member). */
export async function isFounder(roomId: string, member: Author): Promise<boolean> {
  const { data } = await db
    .from('app_room_members')
    .select('id')
    .eq('room_id', roomId)
    .eq('member_platform', member.member_platform)
    .eq('member_type', member.member_type)
    .eq('member_ref', member.member_ref)
    .eq('is_founder', true)
    .eq('status', 'active')
    .maybeSingle();
  return !!data;
}

export interface RoomMemberFull extends RoomMember { status: string; member_wallet: string | null; joined_at: string; }

/** All members of a room (any status) for the founder's management view. */
export async function listRoomMembers(roomId: string): Promise<RoomMemberFull[]> {
  const { data } = await db
    .from('app_room_members')
    .select('member_platform, member_type, member_ref, is_founder, vouched_by, status, member_wallet, joined_at')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  return (data as RoomMemberFull[]) ?? [];
}

/** Set a member's status (remove or block). Authorisation is the caller's job. */
export async function setMemberStatus(roomId: string, target: Author, status: 'active' | 'removed' | 'blocked'): Promise<boolean> {
  const { error } = await db
    .from('app_room_members')
    .update({ status })
    .eq('room_id', roomId)
    .eq('member_platform', target.member_platform)
    .eq('member_type', target.member_type)
    .eq('member_ref', target.member_ref);
  return !error;
}

export interface JoinResult { member_id: string | null; outcome: 'joined' | 'already' | 'full' | 'needs_vouch' | 'blocked'; }

/**
 * Join a member to a room through the cap + vouch enforcing RPC, then cache the
 * member's wallet on the row so wallet auth is a single room-scoped lookup. VIA
 * wallets are resolved locally; an RRG member's wallet is passed in.
 */
export async function joinRoom(
  roomId: string,
  member: Author,
  vouchedBy: string | null,
  isFounder: boolean,
  memberWallet?: string | null,
): Promise<JoinResult> {
  const { data, error } = await db.rpc('app_join_room', {
    p_room_id: roomId,
    p_member_platform: member.member_platform,
    p_member_type: member.member_type,
    p_member_ref: member.member_ref,
    p_vouched_by: vouchedBy,
    p_is_founder: isFounder,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const result: JoinResult = { member_id: row?.member_id ?? null, outcome: (row?.outcome ?? 'full') as JoinResult['outcome'] };

  if (result.outcome === 'joined' && result.member_id) {
    const wallet = memberWallet
      ?? (member.member_platform === 'via' ? await resolveViaMemberWallet(member.member_type, member.member_ref) : null);
    if (wallet) {
      await db.from('app_room_members').update({ member_wallet: wallet.toLowerCase() }).eq('id', result.member_id);
    }
  }
  return result;
}

async function appendEvent(roomId: string, kind: RoomEventKind, author: Author, payload: Record<string, unknown>) {
  const { data, error } = await db
    .from('app_room_events')
    .insert({
      room_id: roomId,
      kind,
      author_platform: author.member_platform,
      author_type: author.member_type,
      author_ref: author.member_ref,
      payload,
    })
    .select('id, created_at')
    .single();
  if (error) throw error;
  return data as { id: string; created_at: string };
}

/** A file placed on the table: image/pdf/doc etc. Stored privately; served signed. */
export interface PlacedFileMeta {
  storage_path: string;
  mime:         string;
  filename:     string;
  size:         number;
}

export interface PlacedObject {
  id:              string;
  object_type:     string;
  content:         string;
  corner:          string | null;
  author_platform: string;
  author_ref:      string;
  created_at:      string;
  // File objects (object_type 'image' | 'file') carry these; null otherwise.
  storage_path:    string | null;
  mime:            string | null;
  filename:        string | null;
  size:            number | null;
}

export async function placeObject(
  roomId: string,
  author: Author,
  input: { object_type: string; content: string; corner?: string | null; file?: PlacedFileMeta },
): Promise<{ id: string; created_at: string }> {
  return appendEvent(roomId, 'object_placed', author, {
    object_type: input.object_type,
    content: input.content,
    corner: input.corner ?? null,
    ...(input.file
      ? { storage_path: input.file.storage_path, mime: input.file.mime, filename: input.file.filename, size: input.file.size }
      : {}),
  });
}

function projectObject(r: { id: string; author_platform: string; author_ref: string; payload: Record<string, unknown>; created_at: string }): PlacedObject {
  return {
    id: r.id,
    object_type: String(r.payload.object_type ?? 'errand_result'),
    content: String(r.payload.content ?? r.payload.summary ?? ''),
    corner: (r.payload.corner as string | null) ?? null,
    author_platform: r.author_platform,
    author_ref: r.author_ref,
    created_at: r.created_at,
    storage_path: (r.payload.storage_path as string | null) ?? null,
    mime: (r.payload.mime as string | null) ?? null,
    filename: (r.payload.filename as string | null) ?? null,
    size: typeof r.payload.size === 'number' ? (r.payload.size as number) : null,
  };
}

export async function sayToRoom(roomId: string, author: Author, text: string) {
  return appendEvent(roomId, 'talk', author, { text });
}

export async function placeErrandResult(roomId: string, author: Author, result: Record<string, unknown>) {
  return appendEvent(roomId, 'errand_result', author, result);
}

/** Project the event log into the current set of objects on the table. */
export async function listTable(roomId: string): Promise<PlacedObject[]> {
  const { data } = await db
    .from('app_room_events')
    .select('id, kind, author_platform, author_ref, payload, created_at')
    .eq('room_id', roomId)
    .in('kind', ['object_placed', 'errand_result'])
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = (data as Array<{ id: string; author_platform: string; author_ref: string; payload: Record<string, unknown>; created_at: string }>) ?? [];
  return rows.map(projectObject);
}

export async function getObject(roomId: string, eventId: string): Promise<PlacedObject | null> {
  const { data } = await db
    .from('app_room_events')
    .select('id, author_platform, author_ref, payload, created_at')
    .eq('room_id', roomId)
    .eq('id', eventId)
    .maybeSingle();
  if (!data) return null;
  return projectObject(data as { id: string; author_platform: string; author_ref: string; payload: Record<string, unknown>; created_at: string });
}

/** Warmth: how recently the room has been touched, for presence without dots. */
export async function roomWarmth(roomId: string): Promise<{ last_event_at: string | null; events_24h: number }> {
  const { data: last } = await db
    .from('app_room_events')
    .select('created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('app_room_events')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .gte('created_at', since);
  return { last_event_at: (last as { created_at: string } | null)?.created_at ?? null, events_24h: count ?? 0 };
}
