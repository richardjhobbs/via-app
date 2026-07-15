-- 0047: Back Room notifications , seen-tracking, per-member prefs, new-count RPC.
--
-- last_seen_at on the membership marks when a member last opened a room, so
-- "new since" (chat + table additions by others) can be computed for the pulse
-- lights and the digest. Prefs hold the email opt-in and the last digest time
-- (max one digest per member per 24h).

alter table app_room_members add column if not exists last_seen_at timestamptz;

create table if not exists app_room_member_prefs (
  member_platform text not null,
  member_type     text not null,
  member_ref      text not null,
  email_digest    boolean not null default true,
  last_digest_at  timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (member_platform, member_type, member_ref)
);

-- New content counts per room for one member: content events (chat, table, and
-- errand results) created after that member last opened the room, not authored
-- by the member themselves. One round-trip for the hub and the banner.
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
   and m.member_ref = p_ref
   and m.status = 'active'
  join app_rooms r on r.id = e.room_id and r.status = 'active'
  where e.kind in ('object_placed', 'talk', 'errand_result')
    and e.created_at > coalesce(m.last_seen_at, m.joined_at, 'epoch'::timestamptz)
    and not (e.author_platform = p_platform and e.author_type = p_type and e.author_ref = p_ref)
  group by e.room_id;
$$;
