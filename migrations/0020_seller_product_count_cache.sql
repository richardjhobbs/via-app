-- 0020_seller_product_count_cache.sql
--
-- The admin Sellers table showed wrong/zero product counts because it counted
-- live: first by fetching rows and tallying (capped at ~1000 by PostgREST),
-- then by per-seller COUNT queries that saturated the connection pool when run
-- ~27x per render (failed counts returned null -> 0). A single GROUP BY over
-- the 200k-row catalogue is a 7-11s seq scan.
--
-- Fix: cache the count per seller. The ingest worker refreshes
-- app_sellers.product_count after each store sync (one index-only count via the
-- (seller_id, external_id) partial index); the admin just reads the column.
-- This is an internal reference view, so per-sync freshness is sufficient.

alter table app_sellers
  add column if not exists product_count integer not null default 0,
  add column if not exists product_count_at timestamptz;

-- One-time backfill of the existing catalogue.
with pc as (
  select seller_id, count(*) as c
  from app_seller_products
  where external_id is not null and admin_removed = false
  group by seller_id
)
update app_sellers s
set product_count = coalesce(pc.c, 0), product_count_at = now()
from (select id from app_sellers) ids
left join pc on pc.seller_id = ids.id
where s.id = ids.id;
