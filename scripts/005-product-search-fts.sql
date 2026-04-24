-- scripts/005-product-search-fts.sql
--
-- Phase A of agent-discoverability scaling — Postgres full-text search on
-- rrg_submissions so search_products scales past the in-memory scan that
-- starts costing when approved row count crosses ~3k.
--
-- Strategy:
--   - A generated tsvector column covering title, retail_sku (raw + digits-only),
--     canonical_name, collab, original_release, enhanced_description,
--     description, and the entire product_attributes JSON stringified.
--   - 'simple' config for fields where stemming corrupts SKUs/codes;
--     'english' config for prose fields.
--   - Weights: A (title, SKU, canonical_name) → B (collab, release, enhanced)
--     → C (description, attributes catch-all).
--   - A normalised SKU copy stripped of dashes/spaces so 'AA3834-100',
--     'AA3834 100' and 'AA3834100' all match.
--   - GIN index on the vector.
--   - search_products_fts() RPC returning id + token_id + rank, filterable
--     by brand_id. App layer looks up full product shape per hit.
--
-- Idempotent — safe to re-run.

BEGIN;

-- Drop first so re-running picks up any vector definition changes.
ALTER TABLE rrg_submissions DROP COLUMN IF EXISTS search_tsv;

ALTER TABLE rrg_submissions ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    -- Weight A: canonical identity fields an agent most often searches by
    setweight(to_tsvector('simple',  coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(product_attributes->>'retail_sku', '')), 'A') ||
    -- SKU with dashes/whitespace stripped so 'AA3834-100' / 'AA3834 100' / 'AA3834100' all match
    setweight(to_tsvector('simple',  coalesce(regexp_replace(product_attributes->>'retail_sku', '[\s\-]+', '', 'g'), '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(product_attributes->>'canonical_name', '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(product_attributes->>'vendor', '')), 'A') ||

    -- Weight B: collab / release / brand context
    setweight(to_tsvector('simple',  coalesce(product_attributes->>'collab', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(product_attributes->>'original_release', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(product_attributes->>'release_year', '')), 'B') ||
    setweight(to_tsvector('english', coalesce(enhanced_description, '')), 'B') ||

    -- Weight C: catch-all — full product_attributes JSON as text catches
    -- alt_names[], style_tags[], occasion_fit[], and any category-specific
    -- attribute the enhance step emits without the index needing schema
    -- changes. Native description stays here too.
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('simple',  coalesce(product_attributes::text, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_rrg_submissions_search_tsv
  ON rrg_submissions USING GIN (search_tsv);

-- ── RPC: search_products_fts ─────────────────────────────────────────
-- Takes a free-text query + optional brand_id + optional network filter
-- (defaults to 'base' for prod). Returns ranked hits.
--
-- The query is OR-expanded: any token matching boosts rank. A SKU-like
-- query (digits after 2+ letters) is also matched against the
-- digits-stripped variant by running a second websearch_to_tsquery over
-- the normalised form.
CREATE OR REPLACE FUNCTION search_products_fts(
  q             text,
  brand_filter  uuid DEFAULT NULL,
  net_filter    text DEFAULT 'base',
  result_limit  int  DEFAULT 10
)
RETURNS TABLE(
  id        uuid,
  token_id  int,
  rank      real
)
LANGUAGE sql STABLE AS $$
  WITH raw_query AS (
    SELECT
      websearch_to_tsquery('simple',  q)                                    AS q_simple,
      websearch_to_tsquery('english', q)                                    AS q_english,
      -- Normalised variant of the query (strip dashes/whitespace) for SKU hits
      websearch_to_tsquery('simple',  regexp_replace(q, '[\s\-]+', '', 'g')) AS q_normalised
  )
  SELECT
    s.id,
    s.token_id,
    GREATEST(
      ts_rank(s.search_tsv, rq.q_simple),
      ts_rank(s.search_tsv, rq.q_english),
      ts_rank(s.search_tsv, rq.q_normalised)
    ) AS rank
  FROM rrg_submissions s
  CROSS JOIN raw_query rq
  WHERE s.status = 'approved'
    AND s.hidden = false
    AND (net_filter IS NULL OR s.network = net_filter)
    AND (brand_filter IS NULL OR s.brand_id = brand_filter)
    AND (
      s.search_tsv @@ rq.q_simple
      OR s.search_tsv @@ rq.q_english
      OR s.search_tsv @@ rq.q_normalised
    )
  ORDER BY rank DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION search_products_fts(text, uuid, text, int) TO anon, authenticated, service_role;

COMMIT;
