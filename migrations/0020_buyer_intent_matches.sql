-- migrations/0020_buyer_intent_matches.sql
--
-- The outbound sourcing loop. An open buying intent (app_buyer_intents) is run
-- through the VIA catalogue search (lib/app/seller-catalog.searchCatalog) and
-- the ranked product hits are stored here as matches. This is what turns a
-- brief from an inert note into something the agent acts on: matches power the
-- buyer dashboard and notify the owner.
--
-- Written server-side only (service role): on intent create
-- (POST /api/buyer/[buyerId]/intents) and on the re-match cron
-- (/api/cron/match-intents). Each row is a point-in-time snapshot of a seller
-- product so the match survives the product later churning out of the catalogue.
--
-- Dedup: unique (intent_id, product_id) , re-running a match never duplicates.
-- status: new (unseen) | seen (owner viewed) | dismissed (owner hid it).

create table if not exists app_buyer_intent_matches (
  id              uuid primary key default gen_random_uuid(),
  intent_id       uuid not null references app_buyer_intents(id) on delete cascade,
  buyer_id        uuid not null references app_buyers(id) on delete cascade,
  product_id      uuid not null,                          -- app_seller_products.id snapshot ref (not FK: products churn)
  seller_slug     text not null,
  seller_name     text not null,
  title           text not null,
  price_usdc      numeric,                                -- null = price on request
  currency        text not null default 'USDC',
  image_url       text,
  product_url     text not null,                          -- human product page
  seller_mcp_url  text not null,                          -- where the agent transacts
  score           numeric not null default 0,             -- relevance, for ordering
  status          text not null default 'new' check (status in ('new', 'seen', 'dismissed')),
  created_at      timestamptz not null default now(),
  unique (intent_id, product_id)
);

create index if not exists app_buyer_intent_matches_buyer_recent_idx
  on app_buyer_intent_matches (buyer_id, created_at desc);

create index if not exists app_buyer_intent_matches_intent_idx
  on app_buyer_intent_matches (intent_id);

alter table app_buyer_intent_matches enable row level security;

-- Owner-scoped reads: a user sees matches for buyers they own. Mirrors the
-- owner-only posture on app_buyers (migration 0010). Inserts are service-role
-- only (no insert policy), matching app_notifications.
drop policy if exists app_buyer_intent_matches_owner_select on app_buyer_intent_matches;
create policy app_buyer_intent_matches_owner_select on app_buyer_intent_matches
  for select using (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  );

drop policy if exists app_buyer_intent_matches_owner_update on app_buyer_intent_matches;
create policy app_buyer_intent_matches_owner_update on app_buyer_intent_matches
  for update using (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  ) with check (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  );
