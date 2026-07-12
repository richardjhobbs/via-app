-- 0036_rooms.sql
--
-- Back Room, Phase D: the room itself. A private capped group formed from
-- accepted introductions, a brand's invitation, or an event guest list. Rooms
-- start small and grow only by member vouching; every non-founder join carries
-- the voucher's ref and is visible in the room. Hard cap 50.
--
-- The room's contents are an EVENT-SHAPED log (app_room_events): every mutable
-- write is one record with kind / author / payload / created_at, deliberately
-- the shape of a NOSTR event, so the later move to private/encrypted events on
-- the relay is a transport swap and not a remodel. app_room_events IS the table
-- the members gather around; the current table state is a projection of the log.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0036_rooms.sql

create table if not exists app_rooms (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  accent_hex   text        not null default '#8a5a3c',   -- one accent per room
  created_from text        not null default 'introduction'
                 check (created_from in ('introduction', 'brand', 'event')),
  member_cap   integer     not null default 50,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists app_room_members (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references app_rooms(id) on delete cascade,
  member_type text        not null check (member_type in ('buyer', 'seller')),
  member_ref  text        not null,
  is_founder  boolean     not null default false,
  vouched_by  text,                                  -- the voucher's ref; required unless founder (enforced in app_join_room)
  joined_at   timestamptz not null default now()
);

-- One membership per member per room.
create unique index if not exists uq_app_room_members_room_member
  on app_room_members (room_id, member_type, member_ref);
create index if not exists idx_app_room_members_room on app_room_members (room_id, joined_at);

create table if not exists app_room_events (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references app_rooms(id) on delete cascade,
  kind        text        not null
                 check (kind in ('object_placed', 'object_moved', 'corner_assigned', 'talk', 'errand_result')),
  author_type text        not null check (author_type in ('buyer', 'seller')),
  author_ref  text        not null,
  payload     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- The table, newest first; the projection reads the whole log for a room.
create index if not exists idx_app_room_events_room on app_room_events (room_id, created_at desc);
create index if not exists idx_app_room_events_kind on app_room_events (room_id, kind, created_at desc);

alter table app_rooms        enable row level security;
alter table app_room_members enable row level security;
alter table app_room_events  enable row level security;
-- No public policies: only the service role (server) reads/writes room state.

-- Every human action and every agent action is an MCP tool call; log which room
-- each call touched so the per-room surface is auditable like the per-seller and
-- per-buyer ones. Column is nullable: existing seller/buyer interactions have no room.
alter table app_mcp_interactions add column if not exists room_id uuid;
create index if not exists idx_app_mcp_interactions_room
  on app_mcp_interactions (room_id) where room_id is not null;

-- Atomically join a member to a room. Locks the room row so concurrent joins
-- serialise on the member count, enforces the hard cap and the vouch rule,
-- dedupes, and inserts the membership. Returns the membership id plus an outcome:
--   'joined'      : added to the room
--   'already'     : this member is already in the room (idempotent)
--   'full'        : the room is at its member cap
--   'needs_vouch' : a non-founder join arrived without a voucher ref
-- Mirrors the app_claim_event_seat lock-and-check pattern (migration 0032).
create or replace function app_join_room(
  p_room_id     uuid,
  p_member_type text,
  p_member_ref  text,
  p_vouched_by  text,
  p_is_founder  boolean
) returns table (member_id uuid, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  v_cap      integer;
  v_count    integer;
  v_existing uuid;
  v_new      uuid;
begin
  -- Serialise concurrent joins for this room on the member count.
  select member_cap into v_cap from app_rooms where id = p_room_id for update;
  if v_cap is null then
    return query select null::uuid, 'full'::text;   -- no such room; treat as not joinable
    return;
  end if;

  select id into v_existing
    from app_room_members
   where room_id = p_room_id
     and member_type = p_member_type
     and member_ref = p_member_ref
   limit 1;
  if v_existing is not null then
    return query select v_existing, 'already'::text;
    return;
  end if;

  -- Every non-founder must be vouched in by someone already inside.
  if not p_is_founder and (p_vouched_by is null or length(trim(p_vouched_by)) = 0) then
    return query select null::uuid, 'needs_vouch'::text;
    return;
  end if;

  select count(*) into v_count from app_room_members where room_id = p_room_id;
  if v_count >= v_cap then
    return query select null::uuid, 'full'::text;
    return;
  end if;

  insert into app_room_members (room_id, member_type, member_ref, is_founder, vouched_by)
  values (p_room_id, p_member_type, p_member_ref, p_is_founder,
          case when p_is_founder then null else trim(p_vouched_by) end)
  returning id into v_new;

  return query select v_new, 'joined'::text;
end;
$$;

revoke execute on function app_join_room(uuid, text, text, text, boolean) from public, anon, authenticated;
grant  execute on function app_join_room(uuid, text, text, text, boolean) to service_role;
