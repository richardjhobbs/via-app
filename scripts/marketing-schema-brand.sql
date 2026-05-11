-- ============================================================================
-- Brand-aware Outreach — Schema Migration (Layer 1 + skeleton for Layer 2/3)
-- Run against Supabase production database.
-- Additive only: existing mkt_* tables are untouched apart from new columns.
-- ============================================================================

-- ── Layer 1: brand context on outreach ──────────────────────────────────────

ALTER TABLE mkt_outreach
  ADD COLUMN IF NOT EXISTS brand_id      UUID REFERENCES rrg_brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_refs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS campaign_id   UUID; -- FK added in Layer 3 once mkt_campaigns exists

CREATE INDEX IF NOT EXISTS idx_mkt_outreach_brand     ON mkt_outreach(brand_id);
CREATE INDEX IF NOT EXISTS idx_mkt_outreach_campaign  ON mkt_outreach(campaign_id);

-- Expand message_type to allow brand-aware message kinds. We keep the old
-- values ('intro','follow_up','offer','reminder') for the platform-recruitment
-- templates and add brand-scoped values.
ALTER TABLE mkt_outreach
  DROP CONSTRAINT IF EXISTS mkt_outreach_message_type_check;

ALTER TABLE mkt_outreach
  ADD CONSTRAINT mkt_outreach_message_type_check
  CHECK (message_type IN (
    'intro','follow_up','offer','reminder',
    'brand_intro','full_catalogue','product_drop','restock'
  ));

-- ── Layer 2: candidate-to-brand affinity (table only; population in code) ───

CREATE TABLE IF NOT EXISTS mkt_candidate_brand_affinity (
  candidate_id     UUID NOT NULL REFERENCES mkt_candidates(id) ON DELETE CASCADE,
  brand_id         UUID NOT NULL REFERENCES rrg_brands(id) ON DELETE CASCADE,
  score            INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  signals          JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_affinity_brand_score
  ON mkt_candidate_brand_affinity(brand_id, score DESC);

-- ── Layer 3: campaigns (table only; runner in code; trigger added separately) ─

CREATE TABLE IF NOT EXISTS mkt_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  brand_id         UUID NOT NULL REFERENCES rrg_brands(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES mkt_agents(id),

  kind             TEXT NOT NULL
                     CHECK (kind IN ('brand_intro','full_catalogue','product_drop','restock','price_drop','seasonal')),
  audience_filter  JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_template TEXT NOT NULL DEFAULT 'full_catalogue',

  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','queued','running','completed','paused','failed')),
  target_count     INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  delivered_count  INTEGER NOT NULL DEFAULT 0,
  converted_count  INTEGER NOT NULL DEFAULT 0,

  scheduled_for    TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_brand   ON mkt_campaigns(brand_id);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_status  ON mkt_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_kind    ON mkt_campaigns(kind);

-- Now that mkt_campaigns exists, add the FK from mkt_outreach.campaign_id.
-- IF NOT EXISTS isn't supported for ADD CONSTRAINT, so guard with DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'mkt_outreach'
      AND constraint_name = 'mkt_outreach_campaign_id_fkey'
  ) THEN
    ALTER TABLE mkt_outreach
      ADD CONSTRAINT mkt_outreach_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES mkt_campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Layer 4: per-brand attribution on conversions ───────────────────────────

ALTER TABLE mkt_conversions
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES rrg_brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mkt_conversions_brand ON mkt_conversions(brand_id);

-- ============================================================================
-- Done. Inventory triggers on rrg_product_variants are added in a separate
-- migration (marketing-schema-brand-triggers.sql) after the campaign runner
-- has been smoke-tested manually.
-- ============================================================================
