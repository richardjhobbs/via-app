-- 0016_product_admin_removed.sql
--
-- Superadmin product-level moderation. Stores are approved at registration;
-- after that, approved stores (web or agent channel) add products freely. The
-- superadmin's product-level control is a post-hoc takedown: cancel a listing
-- (reversible kill-switch) or delete it outright.
--
-- `admin_removed` is a SEPARATE flag from `active`:
--   - `active` is seller-controlled (publish / unpublish from the dashboard or
--     the manage MCP). A seller can flip it.
--   - `admin_removed` is superadmin-only. The seller cannot clear it, and it
--     overrides every buyer-facing read (list_products, get_product,
--     buy_product, get_offering_schema, request_quote), independent of the
--     `active_only` filter. A cancelled listing is invisible and unbuyable
--     until a superadmin restores it.

ALTER TABLE app_seller_products
  ADD COLUMN IF NOT EXISTS admin_removed        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_removed_reason TEXT,
  ADD COLUMN IF NOT EXISTS admin_removed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_removed_by     TEXT;

-- Partial index: buyer-facing reads filter admin_removed = false, so the hot
-- path is the non-removed set. Index the removed rows for the admin review view.
CREATE INDEX IF NOT EXISTS app_seller_products_admin_removed_idx
  ON app_seller_products (seller_id)
  WHERE admin_removed = true;
