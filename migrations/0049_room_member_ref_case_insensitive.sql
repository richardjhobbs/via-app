-- 0049: member refs match case-insensitively in the room membership layer.
--
-- RRG concierge refs carry whatever case the federation hands over ("amir" was
-- seeded, the invite path resolved "Amir"), and app_join_room's dedupe compared
-- member_ref exactly, so the same person could be seated twice in one room.
--
-- 1. Merge existing duplicates: within (room_id, platform, type, lower(ref))
--    keep the founder row first, else the earliest join; delete the rest.
-- 2. app_join_room dedupes on lower(member_ref).
-- 3. Unique index on (room_id, member_platform, member_type, lower(member_ref))
--    so a race can never recreate the duplicate.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0049_room_member_ref_case_insensitive.sql

with ranked as (
  select id,
         row_number() over (
           partition by room_id, member_platform, member_type, lower(member_ref)
           order by is_founder desc, joined_at asc
         ) as rn,
         max(last_seen_at) over (
           partition by room_id, member_platform, member_type, lower(member_ref)
         ) as group_seen
    from app_room_members
)
update app_room_members m
   set last_seen_at = r.group_seen
  from ranked r
 where m.id = r.id and r.rn = 1
   and r.group_seen is distinct from m.last_seen_at;

with ranked as (
  select id,
         row_number() over (
           partition by room_id, member_platform, member_type, lower(member_ref)
           order by is_founder desc, joined_at asc
         ) as rn
    from app_room_members
)
delete from app_room_members m
 using ranked r
 where m.id = r.id and r.rn > 1;

create unique index if not exists uq_app_room_members_ref_ci
  on app_room_members (room_id, member_platform, member_type, lower(member_ref));

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
     and lower(member_ref) = lower(p_member_ref)
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

  insert into app_room_members (room_id, member_platform, member_type, member_ref, vouched_by, is_founder)
  values (p_room_id, p_member_platform, p_member_type, p_member_ref,
          case when p_is_founder then null else trim(p_vouched_by) end,
          p_is_founder)
  returning id into v_new;

  return query select v_new, 'joined'::text;
end;
$$;

revoke execute on function app_join_room(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant  execute on function app_join_room(uuid, text, text, text, text, boolean) to service_role;

-- New-content counts must find the member row (and exclude the member's own
-- events) whatever case the session ref carries.
create or replace function app_room_new_counts(p_platform text, p_type text, p_ref text)
returns table(room_id uuid, n integer)
language sql
stable
as $$
  select e.room_id, count(*)::int
  from app_room_events e
  join app_room_members m
    on m.room_id = e.room_id
   and m.member_platform = p_platform
   and m.member_type = p_type
   and lower(m.member_ref) = lower(p_ref)
   and m.status = 'active'
  join app_rooms r on r.id = e.room_id and r.status = 'active'
  where e.kind in ('object_placed', 'talk', 'errand_result')
    and e.created_at > coalesce(m.last_seen_at, m.joined_at, 'epoch'::timestamptz)
    and not (e.author_platform = p_platform and e.author_type = p_type and lower(e.author_ref) = lower(p_ref))
  group by e.room_id;
$$;
