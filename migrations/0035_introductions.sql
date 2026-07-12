-- 0035_introductions.sql
--
-- Back Room, Phase C: the introduction. When two members are a match (curated
-- by hand for the seed room; the taste matcher plugs in later), each is offered
-- a warm, double-opt-in introduction carrying a context pack. On mutual accept
-- the introduction connects and a room can form. A decline is SILENT: no
-- notification row is emitted and the other side is never told.
--
-- The two sides are stored as (type, ref) pairs, polymorphic like taste
-- profiles. Each side records its own response; the row's status is the
-- combined state:
--   proposed  : offered, neither side has accepted yet
--   accepted  : one side accepted, waiting on the other
--   declined  : one side declined (terminal; silent)
--   connected : both sides accepted; a contact channel may be exchanged
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0035_introductions.sql

create table if not exists app_introductions (
  id           uuid        primary key default gen_random_uuid(),
  a_type       text        not null check (a_type in ('buyer', 'seller')),
  a_ref        text        not null,
  b_type       text        not null check (b_type in ('buyer', 'seller')),
  b_ref        text        not null,
  a_accepted   boolean,                              -- null = no response yet
  b_accepted   boolean,
  status       text        not null default 'proposed'
                 check (status in ('proposed', 'accepted', 'declined', 'connected')),
  context_pack jsonb       not null default '{}'::jsonb,   -- why matched, shared refs, what they make, one opening thread
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  connected_at timestamptz
);

-- Do not propose the same pair twice (order-independent within a curation pass;
-- the admin action checks both directions before inserting).
create unique index if not exists uq_app_introductions_pair
  on app_introductions (a_type, a_ref, b_type, b_ref);

-- A member's inbox: introductions awaiting their response, newest first.
create index if not exists idx_app_introductions_a on app_introductions (a_ref, status);
create index if not exists idx_app_introductions_b on app_introductions (b_ref, status);

alter table app_introductions enable row level security;
-- No public policies: only the service role (server) reads/writes introductions.
