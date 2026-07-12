-- 0034_taste_profiles.sql
--
-- Back Room, Phase A: taste profiles. The member's agent has to genuinely know
-- its principal before any matching or room work is meaningful.
--
-- A profile is keyed to a member. The key is polymorphic so a member can be a
-- buyer (handle) or, later, a seller/brand (slug); slice one exercises buyers
-- only. Profiles are versioned: editing writes a new version and flips the
-- active row, so history is kept and the agent always reads exactly one active
-- profile per member. The profile is edited by the human and read by the agent,
-- never inferred and imposed.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0034_taste_profiles.sql
-- Or via the Supabase dashboard SQL editor.

create table if not exists app_taste_profiles (
  id             uuid        primary key default gen_random_uuid(),
  member_type    text        not null check (member_type in ('buyer', 'seller')),
  member_ref     text        not null,               -- buyer handle or seller slug
  version        integer     not null default 1,
  is_active      boolean     not null default true,
  -- Structured fields, human-owned, agent-readable. Each is a JSON array of
  -- short strings; anti_references is what the member is NOT.
  "references"   jsonb       not null default '[]'::jsonb,   -- records, films, designers, eras, places
  obsessions     jsonb       not null default '[]'::jsonb,
  aesthetic_vocab jsonb      not null default '[]'::jsonb,
  anti_references jsonb      not null default '[]'::jsonb,
  voice_text     text        not null default '',            -- free-text, in the member's own words
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Exactly one active profile per member.
create unique index if not exists uq_app_taste_profiles_active
  on app_taste_profiles (member_type, member_ref)
  where is_active;

-- Version history lookup.
create index if not exists idx_app_taste_profiles_member
  on app_taste_profiles (member_type, member_ref, version desc);

alter table app_taste_profiles enable row level security;
-- No public policies: only the service role (server) reads/writes profiles.
