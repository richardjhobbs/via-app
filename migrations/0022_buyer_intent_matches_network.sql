-- migrations/0022_buyer_intent_matches_network.sql
--
-- The buyer sourcing loop now searches the WHOLE VIA network (local VIA + RRG +
-- future members) via lib/app/network-search.searchNetwork, not just the local
-- app_seller_products catalogue. Two small changes let a match row hold a
-- product from any member:
--
--   1. product_id : uuid -> text. A local VIA product's id is a uuid, but a
--      network member's product has no VIA-app uuid. The column is already a
--      non-FK snapshot ref ("products churn", migration 0020), so it just needs
--      to hold either a uuid string (VIA) or the member's stable product URL
--      (RRG drop URL). The cast is lossless; the unique (intent_id, product_id)
--      dedup is unchanged.
--
--   2. source : new column tagging which network member the match came from, so
--      the dashboard can show origin without parsing URLs. Defaults 'via'.

alter table app_buyer_intent_matches
  alter column product_id type text using product_id::text;

alter table app_buyer_intent_matches
  add column if not exists source text not null default 'via';
