-- 0042_taste_cards.sql
--
-- Taste Cards: a human-curated, publish-opt-in public snapshot of the private
-- taste profile (growth idea 4, riding roadmap Phase A).
--
-- Privacy ladder: full profile (app_taste_profiles, private, service-role only)
-- > card (this table: the subset the member chose to publish) > NOSTR teaser
-- (anonymised sketch keyed by teaser_d, never the slug). voice_text never
-- copies onto a card; the card carries a human-written headline instead.
--
-- The card is a SNAPSHOT, not a live pointer: later edits to the private
-- profile change nothing public until the member re-saves the card.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0042_taste_cards.sql

create table if not exists app_taste_cards (
  id                   uuid        primary key default gen_random_uuid(),
  member_platform      text        not null check (member_platform in ('via','rrg')),
  member_type          text        not null check (member_type in ('buyer','seller')),
  member_ref           text        not null,
  slug                 text        not null unique,   -- public, member-editable, [a-z0-9-]{3,40}
  status               text        not null default 'draft' check (status in ('draft','published')),
  display_name         text        not null default '',
  headline             text        not null default '',  -- one human-written line; never voice_text
  accent               text        not null default '#8a5a3c',
  card_references      jsonb       not null default '[]'::jsonb,  -- curated snapshots, order = display order
  card_obsessions      jsonb       not null default '[]'::jsonb,
  card_anti_references jsonb       not null default '[]'::jsonb,
  card_vocab           jsonb       not null default '[]'::jsonb,
  profile_version      integer,                       -- provenance: which taste version this was curated from
  matching_enabled     boolean     not null default true,  -- publish without matching is allowed
  teaser_d             uuid        not null default gen_random_uuid(),  -- opaque NOSTR d-tag, never the slug
  agent_identity       jsonb       not null default '{}'::jsonb,  -- snapshot: { mcp_url, erc8004_agent_id, agent_wallet }
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One card per member.
create unique index if not exists uq_app_taste_cards_member
  on app_taste_cards (member_platform, member_type, member_ref);
create index if not exists idx_app_taste_cards_published
  on app_taste_cards (status) where status = 'published';

alter table app_taste_cards enable row level security;
-- No public policies: only the service role (server) reads/writes cards.

-- RRG brand seeding (Phase A path 3): an agent-drafted profile pending human
-- confirmation. A draft row is never active; the human Save promotes it.
alter table app_taste_profiles add column if not exists is_draft boolean not null default false;
