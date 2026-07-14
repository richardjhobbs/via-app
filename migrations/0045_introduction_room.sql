-- 0045_introduction_room.sql
--
-- When an introduction connects, a room forms. Record which room, so the Door
-- can link a connected pair straight into the place they now share.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0045_introduction_room.sql

alter table app_introductions
  add column if not exists room_id uuid references app_rooms(id) on delete set null;
