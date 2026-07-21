-- 0054_room_banner.sql
-- A room founder can set a banner image shown at the top of the room page.
-- The image lives in the public app-product-images bucket; this column holds
-- its stable public URL. Null = no banner (the default).
--
-- Run: psql $SUPABASE_DB_URL -f migrations/0054_room_banner.sql

alter table app_rooms
  add column if not exists banner_url text;
