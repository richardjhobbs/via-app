-- 0030_buyer_rrg_unique.sql
--
-- Make linked_rrg_agent_id a UNIQUE key so the RRG->VIA buyer migration is
-- race-safe. importConcierge dedups by reading linked_rrg_agent_id then
-- inserting; under the bulk importer two concurrent runs could both pass the
-- read and double-insert (and therefore double-mint an ERC-8004 identity). A
-- unique index turns the losing insert into a 23505 the importer treats as
-- "already linked". Migration 0029 created a plain (non-unique) index; this
-- replaces it. Verified 2026-07-22: no existing duplicates.
--
-- Run: psql $SUPABASE_DB_URL -f migrations/0030_buyer_rrg_unique.sql

drop index if exists app_buyers_linked_rrg_agent_idx;

create unique index if not exists app_buyers_linked_rrg_agent_uidx
  on app_buyers (linked_rrg_agent_id)
  where linked_rrg_agent_id is not null;
