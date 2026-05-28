-- ============================================================================
-- Referral Partner System — Schema Migration
-- Run against Supabase production database.
-- ============================================================================

-- ── 1. Referral Partners ───────────────────────────────────────────────────
-- Creators who opt in as marketing partners. Each gets a unique referral code.

CREATE TABLE IF NOT EXISTS rrg_referral_partners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Link to creator account
  creator_id            UUID NOT NULL REFERENCES rrg_creator_members(id),
  wallet_address        TEXT NOT NULL,
  referral_code         TEXT NOT NULL UNIQUE,       -- 8-char alphanumeric

  -- Config
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'suspended')),
  commission_bps        INTEGER NOT NULL DEFAULT 1000,  -- 10% of platform share

  -- Stats (denormalized for quick reads)
  total_clicks          INTEGER NOT NULL DEFAULT 0,
  total_conversions     INTEGER NOT NULL DEFAULT 0,
  total_commission_usdc NUMERIC(12,6) NOT NULL DEFAULT 0,

  UNIQUE (creator_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_partners_code ON rrg_referral_partners(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_partners_wallet ON rrg_referral_partners(wallet_address);

-- ── 2. Referral Clicks ─────────────────────────────────────────────────────
-- Click log for analytics. IP is hashed for dedup, never stored raw.

CREATE TABLE IF NOT EXISTS rrg_referral_clicks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  partner_id    UUID NOT NULL REFERENCES rrg_referral_partners(id),
  token_id      INTEGER,              -- which drop page was visited (nullable)
  ip_hash       TEXT,                 -- SHA-256 of IP for dedup
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_partner ON rrg_referral_clicks(partner_id);

-- ── 3. Referral Commissions ────────────────────────────────────────────────
-- Tracks commission owed/paid to referral partners.

CREATE TABLE IF NOT EXISTS rrg_referral_commissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  partner_id      UUID NOT NULL REFERENCES rrg_referral_partners(id),
  purchase_id     UUID NOT NULL REFERENCES app_purchases(id),

  -- Amounts
  revenue_usdc    NUMERIC(12,6) NOT NULL,     -- platform share that triggered this
  commission_bps  INTEGER NOT NULL,             -- rate applied (snapshot)
  commission_usdc NUMERIC(12,6) NOT NULL,      -- actual commission amount

  -- Payment
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  paid_at         TIMESTAMPTZ,
  tx_hash         TEXT,                        -- USDC payout tx
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_partner ON rrg_referral_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_status ON rrg_referral_commissions(status);

-- ── 4. Add referral columns to app_purchases ───────────────────────────────

ALTER TABLE app_purchases ADD COLUMN IF NOT EXISTS referral_partner_id UUID REFERENCES rrg_referral_partners(id);
ALTER TABLE app_purchases ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- ============================================================================
-- Done. Next: lib/app/referral.ts for TypeScript helpers.
-- ============================================================================
