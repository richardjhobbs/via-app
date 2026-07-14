-- 0043_taste_matches.sql
--
-- Taste matcher v1 (roadmap Phase B): every judged pair of published taste
-- cards gets exactly one row, whatever the outcome, so a pair is never
-- re-judged (cost control) and there is an audit trail. This table has NO
-- user-facing surface: no feed, no metrics, no ranking. A match a member ever
-- sees arrives only as a knock at their Door (app_introductions).
--
-- Outcomes:
--   below_threshold , judged, not good enough. Permanent for the pair.
--   rate_limited    , judged above threshold but a member was over the monthly
--                     proposal cap. The exact pair is still recorded (deduped).
--   proposed        , became an introduction; intro_id points at it.
--   duplicate       , the pair already had an introduction (any state).
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0043_taste_matches.sql

create table if not exists app_taste_matches (
  id          uuid        primary key default gen_random_uuid(),
  a_platform  text        not null check (a_platform in ('via','rrg')),
  a_type      text        not null check (a_type in ('buyer','seller')),
  a_ref       text        not null,
  b_platform  text        not null check (b_platform in ('via','rrg')),
  b_type      text        not null check (b_type in ('buyer','seller')),
  b_ref       text        not null,
  score       integer     not null,
  shared      jsonb       not null default '[]'::jsonb,   -- validated overlap citations
  verdict     jsonb       not null default '{}'::jsonb,   -- full judge output, audit only
  outcome     text        not null check (outcome in ('below_threshold','rate_limited','proposed','duplicate')),
  intro_id    uuid        references app_introductions(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_app_taste_matches_a on app_taste_matches (a_platform, a_ref, created_at desc);
create index if not exists idx_app_taste_matches_b on app_taste_matches (b_platform, b_ref, created_at desc);

alter table app_taste_matches enable row level security;
-- No public policies: only the service role (server) reads/writes matches.
