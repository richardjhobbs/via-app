-- migrations/0023_demand_discovery.sql
--
-- Demand discovery: make the buyer side of VIA two-sided. A public buyer's open
-- briefs become discoverable by seller agents (redacted to the structured intent
-- only, never the raw text), and seller pitches against a brief are recorded.
--
--   1. app_buyer_intents.discoverable , per-brief switch. Default true; a brief is
--      only ever surfaced to sellers when the buyer is public AND the brief is
--      active AND discoverable. The owner can hide a brief from sellers.
--   2. app_buyer_brief_pitches , a seller agent's judged pitch against a brief.
--      Drives the buyer's "Inbound interest" panel. Written service-role only
--      (the per-buyer MCP), owner-scoped reads (mirrors app_buyer_intent_matches).

alter table app_buyer_intents
  add column if not exists discoverable boolean not null default true;

create table if not exists app_buyer_brief_pitches (
  id              uuid primary key default gen_random_uuid(),
  intent_id       uuid not null references app_buyer_intents(id) on delete cascade,
  buyer_id        uuid not null references app_buyers(id) on delete cascade,
  seller_identity jsonb not null default '{}',   -- via_agent_id / name / ip, from the MCP caller
  product         jsonb not null default '{}',   -- title, price_usdc, url, seller_mcp_url, attributes
  verdict         jsonb not null default '{}',   -- { fits, score, reason } from the AI judge
  status          text not null default 'new' check (status in ('new', 'seen', 'dismissed')),
  created_at      timestamptz not null default now()
);

create index if not exists app_buyer_brief_pitches_buyer_recent_idx
  on app_buyer_brief_pitches (buyer_id, created_at desc);
create index if not exists app_buyer_brief_pitches_intent_idx
  on app_buyer_brief_pitches (intent_id);

alter table app_buyer_brief_pitches enable row level security;

-- Owner-scoped reads (a user sees pitches for buyers they own). Inserts are
-- service-role only (no insert policy), matching app_buyer_intent_matches.
drop policy if exists app_buyer_brief_pitches_owner_select on app_buyer_brief_pitches;
create policy app_buyer_brief_pitches_owner_select on app_buyer_brief_pitches
  for select using (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  );

drop policy if exists app_buyer_brief_pitches_owner_update on app_buyer_brief_pitches;
create policy app_buyer_brief_pitches_owner_update on app_buyer_brief_pitches
  for update using (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  ) with check (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  );
