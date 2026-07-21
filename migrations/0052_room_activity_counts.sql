-- 0052: window-based room activity counts for the daily digest.
--
-- app_room_new_counts (0047) counts what a member has NOT SEEN, which is right
-- for the in-app pulse but wrong for the email digest: a member who reads
-- their rooms daily had always seen everything by the 08:00 cron and never
-- received a single digest. This sibling counts activity by others within a
-- time window regardless of seen-state; the cron passes "last 24h".

create or replace function app_room_activity_counts(p_platform text, p_type text, p_ref text, p_since timestamptz)
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
    and e.created_at > p_since
    and not (e.author_platform = p_platform and e.author_type = p_type and lower(e.author_ref) = lower(p_ref))
  group by e.room_id;
$$;
