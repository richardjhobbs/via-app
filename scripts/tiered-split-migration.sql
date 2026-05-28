-- Tiered Split Migration
-- Adds drop_type to rrg_submissions and audit columns to app_purchases.
-- Run against Supabase production database.

-- 1. Add drop_type to rrg_submissions (derives from is_brand_product but explicit for clarity)
ALTER TABLE rrg_submissions
  ADD COLUMN IF NOT EXISTS drop_type TEXT NOT NULL DEFAULT 'co_created';

-- Backfill existing rows
UPDATE rrg_submissions SET drop_type = 'brand_created' WHERE is_brand_product = true;
UPDATE rrg_submissions SET drop_type = 'co_created'    WHERE is_brand_product = false;

-- 2. Add audit split columns to app_purchases
ALTER TABLE app_purchases
  ADD COLUMN IF NOT EXISTS split_creator_usdc   NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS split_brand_usdc     NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS split_platform_usdc  NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS brand_pct_applied    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS split_model          TEXT;

-- Done. Audit columns are written at purchase time by auto-payout.ts.
