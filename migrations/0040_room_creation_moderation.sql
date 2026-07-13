-- 0040_room_creation_moderation.sql
--
-- Democratised creation + founder moderation.
--
-- Any network agent can create a room now (not just the operator), so each room
-- records who created it and carries a status the superadmin can later suspend.
-- A member row gains a status so a founder (or superadmin) can remove or block a
-- member: a removed member may be vouched back in, a blocked member cannot.
--
-- app_join_room is updated to honour that status:
--   blocked existing row -> 'blocked'
--   active  existing row -> 'already'
--   removed existing row -> reactivated (re-join), returns 'joined'
-- and the cap now counts only ACTIVE members.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0040_room_creation_moderation.sql

alter table app_rooms add column if not exists status text not null default 'active' check (status in ('active','suspended'));
alter table app_rooms add column if not exists created_by_platform text;
alter table app_rooms add column if not exists created_by_type text;
alter table app_rooms add column if not exists created_by_ref text;

alter table app_room_members add column if not exists status text not null default 'active' check (status in ('active','removed','blocked'));

create index if not exists idx_app_rooms_creator on app_rooms (created_by_platform, created_by_type, created_by_ref) where created_by_ref is not null;

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
  v_row      record;
  v_new      uuid;
begin
  select member_cap into v_cap from app_rooms where id = p_room_id for update;
  if v_cap is null then
    return query select null::uuid, 'full'::text;
    return;
  end if;

  select id, status into v_row
    from app_room_members
   where room_id = p_room_id
     and member_platform = p_member_platform
     and member_type = p_member_type
     and member_ref = p_member_ref
   limit 1;
  if found then
    if v_row.status = 'blocked' then
      return query select v_row.id, 'blocked'::text;
      return;
    elsif v_row.status = 'active' then
      return query select v_row.id, 'already'::text;
      return;
    else
      -- removed: allow a re-join (needs a vouch unless founder)
      if not p_is_founder and (p_vouched_by is null or length(trim(p_vouched_by)) = 0) then
        return query select null::uuid, 'needs_vouch'::text;
        return;
      end if;
      select count(*) into v_count from app_room_members where room_id = p_room_id and status = 'active';
      if v_count >= v_cap then
        return query select null::uuid, 'full'::text;
        return;
      end if;
      update app_room_members
         set status = 'active', is_founder = p_is_founder,
             vouched_by = case when p_is_founder then null else trim(p_vouched_by) end,
             joined_at = now()
       where id = v_row.id;
      return query select v_row.id, 'joined'::text;
      return;
    end if;
  end if;

  if not p_is_founder and (p_vouched_by is null or length(trim(p_vouched_by)) = 0) then
    return query select null::uuid, 'needs_vouch'::text;
    return;
  end if;

  select count(*) into v_count from app_room_members where room_id = p_room_id and status = 'active';
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
