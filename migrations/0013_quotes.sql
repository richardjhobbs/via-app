-- migrations/0013_quotes.sql
--
-- Agent-to-agent negotiation primitive. The buyer-facing Sales Agent today
-- is read-only and can only quote a single fixed price_minor per product
-- (see app/sellers/[slug]/mcp/route.ts buy_product). That cannot represent a
-- seller whose price is a function of a configuration: a custom printer
-- (garment x print method x locations x quantity x deadline), but equally
-- custom furniture, catering, tiered software, freight, consulting scope.
--
-- This migration adds two things:
--
--   1. A configure-price-quote (CPQ) layer on app_seller_products. A product
--      is either pricing_mode='fixed' (today's behaviour, price_minor is the
--      settlement price) or pricing_mode='configurable' (price_minor is only a
--      non-binding "from" anchor; the real number is computed from
--      option_schema by lib/app/quote-pricing.ts). The option_schema is fully
--      generic: a list of option groups, no vertical baked in.
--
--   2. app_seller_quotes: one negotiation thread per buyer request. The agent
--      proposes an advisory total; nothing is binding until the human seller
--      approves it. status walks pending_seller_approval -> approved | revised
--      | countered | rejected | expired. thread holds the round-by-round
--      history (who, what selections, what total, note) so a counter can change
--      price, configuration, or terms.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0013_quotes.sql
-- Or via the Supabase dashboard SQL editor.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- Quote ref generator (sibling of app_generate_order_ref from 0006)
-- ─────────────────────────────────────────────────────────────────────
-- Same Crockford base32 alphabet and shape, distinct "QUO-" prefix so a
-- quote ref is never mistaken for an order ref when read aloud or quoted
-- back by a buying agent.

create or replace function app_generate_quote_ref() returns text
language plpgsql as $$
declare
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  result text := 'QUO-' || to_char(now(), 'YYMM') || '-';
  i int;
  pick int;
begin
  for i in 1..6 loop
    pick := least(31, floor(random() * 32)::int);
    result := result || substr(alphabet, pick + 1, 1);
  end loop;
  return result;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- app_seller_products: CPQ columns
-- ─────────────────────────────────────────────────────────────────────
-- pricing_mode discriminates fixed-price listings from configurable ones.
-- Existing rows default to 'fixed' so nothing about today's buy_product /
-- list_products behaviour changes. option_schema is meaningful only when
-- pricing_mode='configurable'; its shape is owned by lib/app/quote-pricing.ts.

alter table app_seller_products
  add column if not exists pricing_mode  text not null default 'fixed'
                             check (pricing_mode in ('fixed', 'configurable')),
  add column if not exists option_schema jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────
-- app_seller_quotes
-- ─────────────────────────────────────────────────────────────────────
-- product_id is nullable so a seller can field an open-ended negotiation
-- that is not yet pinned to a catalog row, but for the v1 PoC every quote
-- references a configurable product.
--
--   selections    : the buyer's chosen option values (validated against the
--                   product's option_schema at request time)
--   proposed_total : the agent's deterministic advisory number (USDC)
--   approved_total : what the human seller actually approved (USDC); null
--                    until approval. May differ from proposed if the seller
--                    revises the price.
--   thread        : ordered negotiation rounds. Each entry:
--                   { round, by: 'agent'|'buyer'|'seller', total_usdc,
--                     selections?, note?, at }
--   valid_until   : when an approved quote stops being honourable.

create table if not exists app_seller_quotes (
  id              uuid primary key default gen_random_uuid(),
  quote_ref       text not null default app_generate_quote_ref(),
  seller_id       uuid not null references app_sellers(id) on delete cascade,
  product_id      uuid references app_seller_products(id) on delete set null,
  buyer_agent_id  text,                                   -- ERC-8004 id, self-asserted
  buyer_wallet    text,                                   -- verifiable Base wallet when present
  contact         text,                                   -- reach-back identifier
  spec            jsonb not null default '{}'::jsonb,     -- free-form buyer brief (deadline, notes)
  selections      jsonb not null default '{}'::jsonb,     -- chosen option values
  proposed_total_usdc numeric(18,6),
  approved_total_usdc numeric(18,6),
  breakdown       jsonb not null default '[]'::jsonb,     -- line-item explanation of proposed_total
  status          text not null default 'pending_seller_approval'
                    check (status in (
                      'pending_seller_approval',
                      'approved',
                      'revised_by_seller',
                      'countered_by_buyer',
                      'rejected',
                      'expired'
                    )),
  thread          jsonb not null default '[]'::jsonb,
  valid_until     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists app_seller_quotes_ref_idx
  on app_seller_quotes (quote_ref);
create index if not exists app_seller_quotes_seller_idx
  on app_seller_quotes (seller_id, created_at desc);
create index if not exists app_seller_quotes_status_idx
  on app_seller_quotes (seller_id, status);
create index if not exists app_seller_quotes_buyer_agent_idx
  on app_seller_quotes (buyer_agent_id) where buyer_agent_id is not null;

create trigger app_seller_quotes_set_updated_at
  before update on app_seller_quotes
  for each row execute function app_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- RLS: owner-scoped reads, mirrors app_purchases. Writes happen through
-- the service-role client (MCP route, admin API), which bypasses RLS.
-- ─────────────────────────────────────────────────────────────────────

alter table app_seller_quotes enable row level security;

create policy "seller_quotes_owner_select" on app_seller_quotes
  for select using (
    exists (select 1 from app_sellers s
            where s.id = app_seller_quotes.seller_id and s.owner_user_id = auth.uid())
  );

commit;
