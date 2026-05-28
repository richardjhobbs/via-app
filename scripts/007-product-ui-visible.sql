-- scripts/007-product-ui-visible.sql
--
-- Splits product visibility between the human storefront (UI) and the agent
-- catalogue (MCP). Agents see the full approved + non-hidden catalogue;
-- humans see a curated subset per brand.
--
-- Why a new column instead of repurposing `hidden`:
--   `hidden=true` is the existing kill-switch — the product is gone from
--   every surface (UI, MCP, search RPC, deep links via getDropByTokenId).
--   A storefront-curation flag is a different axis: it must show the
--   product to agents while hiding it from the storefront grid. Two flags,
--   two predicates.
--
-- Default true so the migration is a no-op visually. Curation is opt-in:
-- admins flip the surplus rows to ui_visible=false from /admin or via
-- a bulk SQL pass.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE rrg_submissions
  ADD COLUMN IF NOT EXISTS ui_visible BOOLEAN NOT NULL DEFAULT true;

-- Partial index supporting the storefront predicate
--   status='approved' AND hidden=false AND ui_visible=true
-- which is hit on every page render of /, /brand, /brand/[slug], /rrg, /rrg/all.
CREATE INDEX IF NOT EXISTS idx_rrg_submissions_storefront
  ON rrg_submissions (brand_id, approved_at DESC)
  WHERE status = 'approved' AND hidden = false AND ui_visible = true;

COMMIT;

-- ── Optional curation helper ──────────────────────────────────────────
--
-- Run this *after* the migration if you want to immediately limit each
-- brand to its 20 newest approved listings on the storefront, while
-- leaving the full catalogue visible to MCP. Edit MAX_PER_BRAND to taste,
-- or skip and curate per-product from /admin.
--
-- WITH ranked AS (
--   SELECT id,
--          row_number() OVER (PARTITION BY brand_id ORDER BY approved_at DESC) AS rn
--   FROM   rrg_submissions
--   WHERE  status = 'approved' AND hidden = false
-- )
-- UPDATE rrg_submissions s
-- SET    ui_visible = (r.rn <= 20)  -- MAX_PER_BRAND
-- FROM   ranked r
-- WHERE  s.id = r.id;
