-- migrations/0007_hermes.sql
--
-- Hermes Brand Concierge lifecycle on app_sellers.
--
-- The persistent Sales Agent for each seller runs as a Hermes profile on
-- the operator's Box (RRG pattern, mirrored here). The in-app /seller/[slug]
-- /admin/sales-agent training chat keeps the inline DeepSeek call (operator
-- teaching memories). Buyer-facing traffic to /sellers/[slug]/mcp's
-- ask_sales_agent tool DELEGATES to the Hermes-provisioned process — no
-- stateless DeepSeek shot in the buyer path.
--
-- Lifecycle:
--   null              not yet flagged (legacy / Stage-1 only)
--   'pending'         operator-side runner picks it up and provisions
--   'provisioned'     live on hermes_concierge_url
--   'failed:<reason>' operator review needed; runner left this on a failure
--
-- The runner script
--   via-agent-wiki/scripts/via-concierges/process-pending-concierges.ps1
-- polls GET /api/admin/hermes-concierge for {status='active', hermes='pending'}
-- and POSTs back 'provisioned' or 'failed:<msg>' once cutover completes.

alter table app_sellers
  add column if not exists hermes_concierge_status text,
  add column if not exists hermes_concierge_url    text;

create index if not exists app_sellers_hermes_pending_idx
  on app_sellers (hermes_concierge_status)
  where hermes_concierge_status = 'pending';

comment on column app_sellers.hermes_concierge_status is
  'Hermes Brand Concierge lifecycle: null = not yet flagged, ''pending'' = queued for provisioning on the Box, ''provisioned'' = live, ''failed:<short reason>'' = operator review needed.';
comment on column app_sellers.hermes_concierge_url is
  'Endpoint the per-seller Hermes concierge daemon answers on once provisioned. Per-seller URL so we can move concierges off the shared Box without app-side changes.';

-- Customer notes: the Hermes Sales Agent writes back free-form notes
-- about buyers it has interacted with, keyed by whatever identity the
-- buyer surfaced (wallet, ERC-8004, contact). Distinct from
-- app_seller_memories (seller voice / policy facts) and
-- app_mcp_interactions (raw tool-call log).

create table if not exists app_seller_customer_notes (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references app_sellers(id) on delete cascade,
  buyer_wallet   text,
  buyer_agent_id text,
  contact        text,
  channel        text not null default 'concierge',
  note           text not null,
  created_at     timestamptz not null default now()
);

create index if not exists app_seller_customer_notes_seller_idx
  on app_seller_customer_notes (seller_id, created_at desc);
create index if not exists app_seller_customer_notes_wallet_idx
  on app_seller_customer_notes (buyer_wallet) where buyer_wallet is not null;
create index if not exists app_seller_customer_notes_agent_idx
  on app_seller_customer_notes (buyer_agent_id) where buyer_agent_id is not null;
