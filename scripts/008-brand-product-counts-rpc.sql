-- scripts/008-brand-product-counts-rpc.sql
--
-- Server-side aggregation for the brand directory (lib/app/db.ts:getBrandsForDirectory).
--
-- Why: getBrandsForDirectory previously fetched every approved + non-hidden
-- rrg_submissions row to count them in JS. Once the catalogue passed 1000
-- rows (after the ui_visible scrape took it to ~2200), PostgREST's default
-- 1000-row response cap silently truncated the result and the landing
-- page's "totalMcpProducts" tile read 1,000 instead of the real total.
--
-- This RPC aggregates server-side and returns one row per brand, so the
-- response is always small regardless of catalogue size.
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION brand_product_counts(brand_ids uuid[])
RETURNS TABLE(
  brand_id uuid,
  ui_count bigint,
  mcp_count bigint,
  latest_approved_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT s.brand_id,
         count(*) FILTER (WHERE s.ui_visible) AS ui_count,
         count(*) AS mcp_count,
         max(s.approved_at) AS latest_approved_at
  FROM rrg_submissions s
  WHERE s.status = 'approved'
    AND s.hidden = false
    AND s.brand_id = ANY(brand_ids)
  GROUP BY s.brand_id
$$;

GRANT EXECUTE ON FUNCTION brand_product_counts(uuid[]) TO anon, authenticated, service_role;
