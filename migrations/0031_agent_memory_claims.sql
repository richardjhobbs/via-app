-- 0031_agent_memory_claims.sql
--
-- Holding table for an RRG buyer agent's memory + persona + chat, snapshotted
-- BEFORE its RRG account is deleted, so the owner can re-register on VIA with a
-- fresh wallet and identity and have their agent pick up where it left off.
--
-- Why this exists: agent_memory / agent_chat_messages on RRG are FK'd to the
-- agent row with ON DELETE CASCADE, so deleting the account destroys the
-- history. This captures it first, keyed by the owner's email, and is claimed
-- on the next VIA buyer registration for that verified address.
--
-- Email is NOT unique on RRG (one owner can hold several agents), so a claim is
-- keyed by the SOURCE AGENT, and a claimer may pick up more than one row.
--
-- Run: psql $SUPABASE_DB_URL -f migrations/0031_agent_memory_claims.sql

create table if not exists app_agent_memory_claims (
  id               uuid primary key default gen_random_uuid(),
  email            text        not null,
  source_platform  text        not null default 'rrg',
  source_agent_id  text        not null,
  agent_name       text,
  persona          jsonb       not null default '{}'::jsonb,
  memories         jsonb       not null default '[]'::jsonb,
  chat_messages    jsonb       not null default '[]'::jsonb,
  memory_count     integer     not null default 0,
  chat_count       integer     not null default 0,
  snapshot_at      timestamptz not null default now(),
  claimed_at       timestamptz,
  claimed_buyer_id uuid references app_buyers(id) on delete set null
);

-- One snapshot per source agent; re-running the snapshot updates in place.
create unique index if not exists app_agent_memory_claims_source_uidx
  on app_agent_memory_claims (source_platform, source_agent_id);

-- Fast lookup of unclaimed snapshots at registration time.
create index if not exists app_agent_memory_claims_email_idx
  on app_agent_memory_claims (lower(email)) where claimed_at is null;

alter table app_agent_memory_claims enable row level security;
