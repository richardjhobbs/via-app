-- 0053_room_member_vibe.sql
-- A per-member Back Room "vibe": a personal palette that follows a member across
-- all their rooms. One column on the existing per-member prefs table (keyed on
-- the member triple). Default 'paper' is the current warm cream skin.
--
-- Run: psql $SUPABASE_DB_URL -f migrations/0053_room_member_vibe.sql

alter table app_room_member_prefs
  add column if not exists vibe text not null default 'paper';
