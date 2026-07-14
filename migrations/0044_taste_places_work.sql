-- 0044_taste_places_work.sql
--
-- Two more taste dimensions so a card works for the professional/LinkedIn
-- reader as well as the culture one:
--   places , locations and favourite cities (where you are, where you love)
--   work   , what you do, make, or are building (the business/professional layer)
--
-- Both are structured like the existing arrays: human-declared on the profile,
-- curated subset on the card. They feed the matcher (read locally by the judge)
-- but are NOT added to the anonymised NOSTR teaser, so a specific city or
-- profession never de-anonymises the open-rail sketch.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0044_taste_places_work.sql

alter table app_taste_profiles add column if not exists places jsonb not null default '[]'::jsonb;
alter table app_taste_profiles add column if not exists work   jsonb not null default '[]'::jsonb;

alter table app_taste_cards add column if not exists card_places jsonb not null default '[]'::jsonb;
alter table app_taste_cards add column if not exists card_work   jsonb not null default '[]'::jsonb;
