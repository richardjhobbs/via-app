-- 0038_member_platform.sql
--
-- A Back Room member is always an agent, and there are four kinds across two
-- platforms: a VIA buying agent, a VIA seller agent, an RRG personal concierge,
-- and an RRG brand concierge. Identity generalises from a single kind to a
-- (platform, kind) pair:
--   platform in ('via','rrg'), kind (member_type) in ('buyer','seller')
--     via/buyer  = VIA buying agent      via/seller = VIA seller agent
--     rrg/buyer  = RRG personal concierge rrg/seller = RRG brand concierge
--
-- refs can collide across platforms (a VIA handle and an RRG slug could match),
-- so platform is part of every member key and uniqueness constraint. Existing
-- rows default to 'via'. RRG members resolve over the existing HTTP federation
-- (wired when the RRG side is built); VIA members resolve locally.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0038_member_platform.sql

alter table app_room_members  add column if not exists member_platform text not null default 'via' check (member_platform in ('via','rrg'));
alter table app_room_events   add column if not exists author_platform text not null default 'via' check (author_platform in ('via','rrg'));
alter table app_taste_profiles add column if not exists member_platform text not null default 'via' check (member_platform in ('via','rrg'));
alter table app_introductions add column if not exists a_platform text not null default 'via' check (a_platform in ('via','rrg'));
alter table app_introductions add column if not exists b_platform text not null default 'via' check (b_platform in ('via','rrg'));

-- Membership uniqueness now spans platform.
drop index if exists uq_app_room_members_room_member;
create unique index if not exists uq_app_room_members_room_member
  on app_room_members (room_id, member_platform, member_type, member_ref);

-- One active taste profile per (platform, kind, ref).
drop index if exists uq_app_taste_profiles_active;
create unique index if not exists uq_app_taste_profiles_active
  on app_taste_profiles (member_platform, member_type, member_ref)
  where is_active;
drop index if exists idx_app_taste_profiles_member;
create index if not exists idx_app_taste_profiles_member
  on app_taste_profiles (member_platform, member_type, member_ref, version desc);

-- Introduction pair uniqueness spans platform on both sides.
drop index if exists uq_app_introductions_pair;
create unique index if not exists uq_app_introductions_pair
  on app_introductions (a_platform, a_type, a_ref, b_platform, b_type, b_ref);

-- app_join_room gains the platform. Drop the old 5-arg signature and replace.
drop function if exists app_join_room(uuid, text, text, text, boolean);
create or replace function app_join_room(
  p_room_id         uuid,
  p_member_platform text,
  p_member_type     text,
  p_member_ref      text,
  p_vouched_by      text,
  p_is_founder      boolean
) returns table (member_id uuid, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  v_cap      integer;
  v_count    integer;
  v_existing uuid;
  v_new      uuid;
begin
  select member_cap into v_cap from app_rooms where id = p_room_id for update;
  if v_cap is null then
    return query select null::uuid, 'full'::text;
    return;
  end if;

  select id into v_existing
    from app_room_members
   where room_id = p_room_id
     and member_platform = p_member_platform
     and member_type = p_member_type
     and member_ref = p_member_ref
   limit 1;
  if v_existing is not null then
    return query select v_existing, 'already'::text;
    return;
  end if;

  if not p_is_founder and (p_vouched_by is null or length(trim(p_vouched_by)) = 0) then
    return query select null::uuid, 'needs_vouch'::text;
    return;
  end if;

  select count(*) into v_count from app_room_members where room_id = p_room_id;
  if v_count >= v_cap then
    return query select null::uuid, 'full'::text;
    return;
  end if;

  insert into app_room_members (room_id, member_platform, member_type, member_ref, is_founder, vouched_by)
  values (p_room_id, p_member_platform, p_member_type, p_member_ref, p_is_founder,
          case when p_is_founder then null else trim(p_vouched_by) end)
  returning id into v_new;

  return query select v_new, 'joined'::text;
end;
$$;

revoke execute on function app_join_room(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant  execute on function app_join_room(uuid, text, text, text, text, boolean) to service_role;
