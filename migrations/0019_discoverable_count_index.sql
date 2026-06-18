-- 0019_discoverable_count_index.sql
--
-- The landing-page "products available" headline (lib/app/network-stats.ts)
-- runs an EXACT count over app_seller_products filtered to the discovery
-- predicate (active, not admin_removed, on_chain_status draft|registered).
-- Once the vinyl catalogue grew past ~70k rows this became a 35s sequential
-- scan over the full table (large jsonb metadata + the FTS column per row),
-- which exceeds the service-role statement_timeout under write load. The count
-- then errors, supabase-js returns count=null -> 0, and the headline silently
-- drops the entire local catalogue, showing only the RRG member total.
--
-- A partial index matching the predicate turns the count into an index-only
-- scan (~26ms): immune to the timeout regardless of catalogue size.
--
-- Applied to production via CREATE INDEX CONCURRENTLY (no write lock during the
-- background ingest); recorded here without CONCURRENTLY so it is safe inside a
-- migration transaction on a fresh database.

create index if not exists app_seller_products_discoverable_idx
on app_seller_products (id)
where active and not admin_removed and on_chain_status in ('draft', 'registered');
