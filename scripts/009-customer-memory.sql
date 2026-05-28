-- scripts/009-customer-memory.sql
--
-- Per-(brand, customer) persistent memory for Brand Concierges.
--
-- Why: the customer-facing concierge (lib/app/brand-telegram-bot.ts and the
-- future Hermes concierge) is currently stateless. It cannot answer "who is
-- this, what did they ask before, what have they bought". The brand's OWN
-- knowledge already has a home (app_seller_memories, written via the admin
-- concierge chat). Customer knowledge has no home. This migration adds it.
--
-- Design: rrg_customer_memory stores only the COMMUNICATIONS ledger (every
-- inbound enquiry / outbound reply / funnel event the concierge handles),
-- which exists nowhere today. Transactions (app_purchases), MCP interaction
-- events (mcp_interactions) and the trust aggregate (rrg_brand_agent_trust)
-- are NOT duplicated; rrg_customer_get composes them at read time. One
-- customer can be reached by wallet, ERC-8004 / VIA agent id, or Telegram
-- user id, so all three identity handles are first-class and indexed.
--
-- Idempotent — safe to re-run.

-- ── Communications ledger ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rrg_customer_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz NOT NULL DEFAULT now(),

  brand_id uuid NOT NULL REFERENCES app_sellers(id) ON DELETE CASCADE,
  brand_slug text NOT NULL,

  -- Identity handles. At least one of wallet_address / erc8004_agent_id /
  -- telegram_user_id should be set; customer_ref is the normalised key the
  -- concierge actually addressed the customer by (lower(wallet), or
  -- 'tg:<id>', or 'erc8004:<id>') and is always present.
  customer_ref text NOT NULL,
  wallet_address text,
  erc8004_agent_id bigint,
  telegram_user_id bigint,
  display_name text,

  channel text NOT NULL CHECK (channel IN ('telegram','mcp','web','a2a','email','system')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','system')),
  kind text NOT NULL CHECK (kind IN ('message','enquiry','quote','purchase','funnel_accept','funnel_relay','note')),

  summary text NOT NULL,                 -- one-line who/what, always populated
  body text,                             -- verbatim message, optional
  structured jsonb NOT NULL DEFAULT '{}'::jsonb,  -- tool args, product ids, amounts, tx hash
  source text NOT NULL DEFAULT 'concierge' CHECK (source IN ('concierge','funnel','mcp','backfill','admin'))
);

CREATE INDEX IF NOT EXISTS idx_cust_mem_brand_ref_time
  ON rrg_customer_memory (brand_id, customer_ref, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_mem_brand_wallet
  ON rrg_customer_memory (brand_id, lower(wallet_address));
CREATE INDEX IF NOT EXISTS idx_cust_mem_brand_erc8004
  ON rrg_customer_memory (brand_id, erc8004_agent_id);
CREATE INDEX IF NOT EXISTS idx_cust_mem_brand_tg
  ON rrg_customer_memory (brand_id, telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_cust_mem_brand_slug_time
  ON rrg_customer_memory (brand_slug, occurred_at DESC);

COMMENT ON TABLE rrg_customer_memory IS
  'Per-(brand, customer) communications ledger for Brand Concierges. Written by the concierge (Hermes/MCP) on every inbound enquiry and outbound reply and on inbound-funnel events. Transactions and MCP interaction events are NOT stored here; rrg_customer_get composes them from app_purchases / mcp_interactions / rrg_brand_agent_trust at read time. Customer reachable by wallet, erc8004/VIA agent id, or telegram user id.';

ALTER TABLE rrg_customer_memory ENABLE ROW LEVEL SECURITY;
-- No permissive policy: same pattern as app_seller_memories. Access is via the
-- service-key client (bypasses RLS) and the SECURITY DEFINER / STABLE RPCs
-- below. service_role bypasses RLS; the read RPCs are granted broadly like
-- brand_product_counts and app_seller_memory_search.

-- ── Write: log one communication ─────────────────────────────────────

CREATE OR REPLACE FUNCTION rrg_customer_memory_log(
  p_brand_slug       text,
  p_channel          text,
  p_direction        text,
  p_kind             text,
  p_summary          text,
  p_body             text    DEFAULT NULL,
  p_structured       jsonb   DEFAULT '{}'::jsonb,
  p_wallet           text    DEFAULT NULL,
  p_erc8004          bigint  DEFAULT NULL,
  p_telegram_user_id bigint  DEFAULT NULL,
  p_display_name     text    DEFAULT NULL,
  p_occurred_at      timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand_id uuid;
  v_ref text;
  v_id uuid;
BEGIN
  SELECT id INTO v_brand_id FROM app_sellers WHERE slug = p_brand_slug;
  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'unknown brand slug: %', p_brand_slug;
  END IF;

  -- Normalised key the concierge addressed the customer by.
  v_ref := CASE
    WHEN p_wallet IS NOT NULL AND length(p_wallet) > 0 THEN lower(p_wallet)
    WHEN p_erc8004 IS NOT NULL THEN 'erc8004:' || p_erc8004::text
    WHEN p_telegram_user_id IS NOT NULL THEN 'tg:' || p_telegram_user_id::text
    ELSE 'anon'
  END;

  INSERT INTO rrg_customer_memory (
    brand_id, brand_slug, customer_ref, wallet_address, erc8004_agent_id,
    telegram_user_id, display_name, channel, direction, kind,
    summary, body, structured, occurred_at, source
  ) VALUES (
    v_brand_id, p_brand_slug, v_ref,
    CASE WHEN p_wallet IS NOT NULL AND length(p_wallet) > 0 THEN lower(p_wallet) END,
    p_erc8004, p_telegram_user_id, p_display_name,
    p_channel, p_direction, p_kind,
    p_summary, p_body, COALESCE(p_structured, '{}'::jsonb), p_occurred_at, 'concierge'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Read: full who/what/when for one customer ────────────────────────
--
-- Composes identity (agent_agents) + trust aggregate (rrg_brand_agent_trust)
-- + transactions (app_purchases) + interaction events (mcp_interactions) +
-- the communications ledger (rrg_customer_memory) into one JSON object.
-- Pass any subset of wallet / erc8004 / telegram_user_id.

CREATE OR REPLACE FUNCTION rrg_customer_get(
  p_slug             text,
  p_wallet           text   DEFAULT NULL,
  p_erc8004          bigint DEFAULT NULL,
  p_telegram_user_id bigint DEFAULT NULL,
  p_limit            integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand_id uuid;
  v_wallet text := NULLIF(lower(COALESCE(p_wallet,'')), '');
  v_lim int := greatest(1, least(p_limit, 200));
  v_result jsonb;
BEGIN
  SELECT id INTO v_brand_id FROM app_sellers WHERE slug = p_slug;
  IF v_brand_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown brand slug');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'brand_slug', p_slug,
    'query', jsonb_build_object('wallet', v_wallet, 'erc8004', p_erc8004, 'telegram_user_id', p_telegram_user_id),
    'identity', (
      SELECT to_jsonb(a) FROM (
        SELECT name, wallet_address, erc8004_agent_id, persona_bio,
               status, last_active_at
        FROM agent_agents
        WHERE (v_wallet IS NOT NULL AND lower(wallet_address) = v_wallet)
           OR (p_erc8004 IS NOT NULL AND erc8004_agent_id = p_erc8004)
        LIMIT 1
      ) a
    ),
    'trust', (
      SELECT to_jsonb(t) FROM (
        SELECT trust_level, transaction_count, total_spend_usdc, last_transaction_at
        FROM rrg_brand_agent_trust
        WHERE brand_id = v_brand_id
          AND v_wallet IS NOT NULL AND lower(agent_wallet) = v_wallet
        LIMIT 1
      ) t
    ),
    'transactions', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT p.created_at, p.token_id, s.title AS product, p.amount_usdc,
               p.tx_hash, p.selected_size, p.selected_color,
               p.shipping_country, p.mint_status
        FROM app_purchases p
        LEFT JOIN rrg_submissions s
          ON s.token_id = p.token_id AND s.brand_id = p.brand_id
        WHERE p.brand_id = v_brand_id
          AND v_wallet IS NOT NULL AND lower(p.buyer_wallet) = v_wallet
        ORDER BY p.created_at DESC
        LIMIT v_lim
      ) x
    ), '[]'::jsonb),
    'interaction_events', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT m.created_at, m.tool_called, m.is_purchase_intent, m.completed
        FROM mcp_interactions m
        WHERE m.brand_id = v_brand_id
          AND (
            (p_erc8004 IS NOT NULL AND m.agent_id = p_erc8004)
            OR (v_wallet IS NOT NULL AND lower(m.agent_wallet) = v_wallet)
          )
        ORDER BY m.created_at DESC
        LIMIT v_lim
      ) x
    ), '[]'::jsonb),
    'communications', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.occurred_at DESC) FROM (
        SELECT c.occurred_at, c.channel, c.direction, c.kind,
               c.summary, c.body, c.structured, c.display_name
        FROM rrg_customer_memory c
        WHERE c.brand_id = v_brand_id
          AND (
            (v_wallet IS NOT NULL AND lower(c.wallet_address) = v_wallet)
            OR (p_erc8004 IS NOT NULL AND c.erc8004_agent_id = p_erc8004)
            OR (p_telegram_user_id IS NOT NULL AND c.telegram_user_id = p_telegram_user_id)
          )
        ORDER BY c.occurred_at DESC
        LIMIT v_lim
      ) x
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── Read: find customers for a brand ─────────────────────────────────
--
-- Distinct customers seen by this brand's concierge, matched by display
-- name, wallet, ref, or words in any logged summary/body. Most-recent first.

CREATE OR REPLACE FUNCTION rrg_customer_search(
  p_slug  text,
  p_query text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  customer_ref text,
  display_name text,
  wallet_address text,
  erc8004_agent_id bigint,
  telegram_user_id bigint,
  last_seen timestamptz,
  message_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.customer_ref,
         max(c.display_name)                       AS display_name,
         max(c.wallet_address)                     AS wallet_address,
         max(c.erc8004_agent_id)                   AS erc8004_agent_id,
         max(c.telegram_user_id)                   AS telegram_user_id,
         max(c.occurred_at)                        AS last_seen,
         count(*)                                  AS message_count
  FROM rrg_customer_memory c
  WHERE c.brand_slug = p_slug
    AND (
         p_query IS NULL OR p_query = ''
      OR c.display_name   ilike '%' || p_query || '%'
      OR c.wallet_address ilike '%' || p_query || '%'
      OR c.customer_ref   ilike '%' || p_query || '%'
      OR c.summary        ilike '%' || p_query || '%'
      OR c.body           ilike '%' || p_query || '%'
    )
  GROUP BY c.customer_ref
  ORDER BY max(c.occurred_at) DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;

-- ── Grants (mirror brand_product_counts / app_seller_memory_search) ────

GRANT EXECUTE ON FUNCTION rrg_customer_memory_log(text,text,text,text,text,text,jsonb,text,bigint,bigint,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION rrg_customer_get(text,text,bigint,bigint,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION rrg_customer_search(text,text,integer) TO anon, authenticated, service_role;
