-- migrations/0029_rrg_concierge_link.sql
--
-- Link an RRG personal concierge to a VIA buying agent and keep its learned
-- memories in sync. The RRG agent and the VIA buyer are SEPARATE records on
-- separate Supabase projects: the VIA buying agent always has its own
-- platform-derived identity wallet (AGENT_WALLET_SEED) and its own ERC-8004
-- token. This link is provenance + a sync key, not a shared identity.
--
--   1. app_buyers.linked_rrg_agent_id , the RRG agent id this buyer was imported
--      from (null for natively-registered buyers). The sync cron iterates buyers
--      where this is set and pulls fresh memories from RRG over HTTP.
--   2. app_buyer_memories.external_source / external_id , provenance for an
--      imported memory ('rrg' + the RRG agent_memory row id). The unique index
--      makes re-pulling idempotent: a memory already imported is never duplicated.

alter table app_buyers
  add column if not exists linked_rrg_agent_id text;

create index if not exists app_buyers_linked_rrg_agent_idx
  on app_buyers (linked_rrg_agent_id) where linked_rrg_agent_id is not null;

alter table app_buyer_memories
  add column if not exists external_source text,
  add column if not exists external_id     text;

-- One row per (buyer, source, external id). Lets the sync upsert by external id
-- so a repeated pull updates the existing row instead of inserting a duplicate.
create unique index if not exists app_buyer_memories_external_uidx
  on app_buyer_memories (buyer_id, external_source, external_id)
  where external_source is not null and external_id is not null;
