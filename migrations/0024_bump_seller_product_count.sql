-- 0024_bump_seller_product_count.sql
--
-- Atomic increment/decrement for the cached app_sellers.product_count
-- (migration 0020). The cache was only ever refreshed by the ingest worker, so
-- products added through the seller dashboard / API never moved it and the
-- superadmin Sellers list showed 0 for hand-built stores. The dashboard create
-- route now calls this after inserting a product. O(1), no catalogue scan, so
-- it is safe regardless of store size (unlike a per-seller COUNT over the
-- 200k-row catalogue, which is exactly what the cache exists to avoid).
create or replace function app_bump_seller_product_count(p_seller_id uuid, p_delta int)
returns void
language sql
as $$
  update app_sellers
  set product_count = greatest(0, product_count + p_delta),
      product_count_at = now()
  where id = p_seller_id;
$$;
