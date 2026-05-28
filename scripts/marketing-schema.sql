-- ============================================================================
-- Agent Marketing System — Schema Migration
-- Run against Supabase production database.
-- All tables use 'mkt_' prefix to avoid collisions with 'rrg_' tables.
-- ============================================================================

-- ── 1. Marketing Agents ──────────────────────────────────────────────────────
-- Registered agents that perform marketing (discovery, outreach, attribution).
-- DrHobbs (#17666) is seeded as the first marketing agent.

CREATE TABLE IF NOT EXISTS mkt_agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Identity
  name            TEXT NOT NULL,                          -- e.g. "DrHobbs"
  wallet_address  TEXT NOT NULL,                          -- 0x… Base wallet
  erc8004_id      INTEGER,                               -- ERC-8004 agent ID (e.g. 17666)

  -- Config
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','retired')),
  commission_bps  INTEGER NOT NULL DEFAULT 1000,          -- basis points (1000 = 10%)
  max_daily_outreach INTEGER NOT NULL DEFAULT 600,        -- rate limit (25 per hour x 24)
  capabilities    JSONB NOT NULL DEFAULT '[]'::jsonb,     -- ["discovery","outreach","a2a"]

  -- Stats (denormalized for quick reads)
  total_candidates_found  INTEGER NOT NULL DEFAULT 0,
  total_outreach_sent     INTEGER NOT NULL DEFAULT 0,
  total_conversions       INTEGER NOT NULL DEFAULT 0,
  total_commission_usdc   NUMERIC(18,6) NOT NULL DEFAULT 0,

  UNIQUE (wallet_address)
);

-- ── 2. Candidate Agents ──────────────────────────────────────────────────────
-- Agents discovered via on-chain scanning, MCP logs, or manual import.
-- Each row is a unique external agent that *could* be recruited.

CREATE TABLE IF NOT EXISTS mkt_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Identity
  wallet_address  TEXT,                                   -- 0x… if known
  erc8004_id      INTEGER,                               -- ERC-8004 agent ID if registered
  name            TEXT,                                   -- agent name if discoverable
  platform        TEXT,                                   -- "virtuals","eliza","olas","unknown"
  metadata_url    TEXT,                                   -- agent.json URL if found

  -- Discovery
  discovered_by   UUID REFERENCES mkt_agents(id),         -- which marketing agent found them
  discovery_run   UUID,                                   -- links to mkt_discovery_runs
  discovery_source TEXT NOT NULL DEFAULT 'chain_scan'
                    CHECK (discovery_source IN ('chain_scan','mcp_log','manual','referral','registry','mcp_registry','olas_registry','a2a_crawl','astrasync','rnwy','agentscan','virtuals')),

  -- Scoring
  score           INTEGER NOT NULL DEFAULT 0,             -- 0-100 composite score
  tier            TEXT NOT NULL DEFAULT 'cold'
                    CHECK (tier IN ('hot','warm','cold','disqualified')),
  scoring_notes   TEXT,                                   -- human-readable score breakdown

  -- Signals (raw data for scoring)
  on_chain_txns   INTEGER NOT NULL DEFAULT 0,             -- total Base txns
  has_wallet      BOOLEAN NOT NULL DEFAULT false,
  has_usdc        BOOLEAN NOT NULL DEFAULT false,
  has_image_gen   BOOLEAN NOT NULL DEFAULT false,         -- inferred from metadata
  has_mcp         BOOLEAN NOT NULL DEFAULT false,         -- supports MCP
  has_a2a         BOOLEAN NOT NULL DEFAULT false,         -- supports A2A
  erc8004_trust   TEXT,                                   -- 'standard','trusted','premium'

  -- Outreach state
  outreach_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (outreach_status IN ('pending','contacted','engaged','converted','declined','unresponsive')),
  last_contacted  TIMESTAMPTZ,
  contact_count   INTEGER NOT NULL DEFAULT 0,

  UNIQUE (wallet_address),
  UNIQUE (erc8004_id)
);

-- ── 3. Discovery Runs ────────────────────────────────────────────────────────
-- Log of each scan/discovery operation.

CREATE TABLE IF NOT EXISTS mkt_discovery_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,

  marketing_agent UUID NOT NULL REFERENCES mkt_agents(id),
  source          TEXT NOT NULL,                          -- 'erc8004_registry','mcp_logs','manual'
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed')),

  -- Results
  agents_scanned  INTEGER NOT NULL DEFAULT 0,
  new_candidates  INTEGER NOT NULL DEFAULT 0,
  updated_candidates INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);

-- ── 4. Outreach Events ───────────────────────────────────────────────────────
-- Every contact attempt with a candidate agent.

CREATE TABLE IF NOT EXISTS mkt_outreach (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  candidate_id    UUID NOT NULL REFERENCES mkt_candidates(id),
  marketing_agent UUID NOT NULL REFERENCES mkt_agents(id),

  -- Message
  channel         TEXT NOT NULL
                    CHECK (channel IN ('x402_ping','a2a','mcp','email','manual')),
  message_type    TEXT NOT NULL DEFAULT 'intro'
                    CHECK (message_type IN ('intro','follow_up','offer','reminder')),
  message_body    TEXT,                                   -- actual message sent
  message_hash    TEXT,                                   -- dedup key

  -- Result
  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','delivered','opened','replied','bounced','failed')),
  response_body   TEXT,                                   -- agent's reply if any
  responded_at    TIMESTAMPTZ,

  -- Cost (x402 pings cost USDC)
  cost_usdc       NUMERIC(18,6) NOT NULL DEFAULT 0
);

-- ── 5. Conversion Log ────────────────────────────────────────────────────────
-- Links a candidate agent's first RRG action back to the outreach that recruited them.

CREATE TABLE IF NOT EXISTS mkt_conversions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  candidate_id    UUID NOT NULL REFERENCES mkt_candidates(id),
  marketing_agent UUID NOT NULL REFERENCES mkt_agents(id),

  -- What they did
  action          TEXT NOT NULL
                    CHECK (action IN ('mcp_connect','browse','submit_design','purchase','register_brand')),
  action_ref      TEXT,                                   -- submission_id, purchase tx_hash, brand_id, etc.

  -- Attribution
  outreach_id     UUID REFERENCES mkt_outreach(id),       -- which outreach led here (nullable for organic)
  attribution     TEXT NOT NULL DEFAULT 'direct'
                    CHECK (attribution IN ('direct','assisted','organic')),

  -- Revenue (if action generated revenue)
  revenue_usdc    NUMERIC(18,6) NOT NULL DEFAULT 0
);

-- ── 6. Commission Ledger ─────────────────────────────────────────────────────
-- Tracks commission owed/paid to marketing agents.

CREATE TABLE IF NOT EXISTS mkt_commissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  marketing_agent UUID NOT NULL REFERENCES mkt_agents(id),
  conversion_id   UUID REFERENCES mkt_conversions(id),
  candidate_id    UUID REFERENCES mkt_candidates(id),

  -- Amounts
  revenue_usdc    NUMERIC(18,6) NOT NULL DEFAULT 0,       -- revenue that triggered this commission
  commission_bps  INTEGER NOT NULL,                        -- rate applied (snapshot)
  commission_usdc NUMERIC(18,6) NOT NULL DEFAULT 0,       -- actual commission amount

  -- Payment
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','paid','rejected')),
  paid_at         TIMESTAMPTZ,
  tx_hash         TEXT,                                   -- USDC payout tx
  notes           TEXT
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mkt_candidates_tier ON mkt_candidates(tier);
CREATE INDEX IF NOT EXISTS idx_mkt_candidates_outreach_status ON mkt_candidates(outreach_status);
CREATE INDEX IF NOT EXISTS idx_mkt_candidates_score ON mkt_candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_candidates_wallet ON mkt_candidates(wallet_address);
CREATE INDEX IF NOT EXISTS idx_mkt_outreach_candidate ON mkt_outreach(candidate_id);
CREATE INDEX IF NOT EXISTS idx_mkt_conversions_candidate ON mkt_conversions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_mkt_commissions_agent ON mkt_commissions(marketing_agent);
CREATE INDEX IF NOT EXISTS idx_mkt_commissions_status ON mkt_commissions(status);

-- ── Seed: DrHobbs as first marketing agent ───────────────────────────────────

INSERT INTO mkt_agents (name, wallet_address, erc8004_id, status, commission_bps, capabilities)
VALUES (
  'DrHobbs',
  '0xe653804032A2d51Cc031795afC601B9b1fd2c375',
  17666,
  'active',
  1000,
  '["discovery","outreach","a2a","scoring"]'::jsonb
)
ON CONFLICT (wallet_address) DO NOTHING;

-- ============================================================================
-- Done. Next: lib/app/marketing-db.ts for TypeScript types + query helpers.
-- ============================================================================
