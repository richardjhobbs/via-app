-- 0055_room_offers.sql
-- In-room exclusive offers: a brand that is a VIA seller member of a Back Room
-- offers one of its products to that room's members first, at a room price
-- (usually a discount ahead of, or instead of, the public listing). The offer
-- renders as a card inside the room and is bought there through the SAME
-- settlement rail as every other purchase (/api/x402/purchase); only room
-- members can create the order.
--
-- Run: psql $SUPABASE_DB_URL -f migrations/0055_room_offers.sql

create table if not exists app_room_offers (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references app_rooms(id) on delete cascade,
  seller_id           uuid not null references app_sellers(id) on delete cascade,
  product_id          uuid not null references app_seller_products(id) on delete cascade,
  -- The room price in USDC 6-decimal minor units. Independent of the product's
  -- list price_minor, which stays what the public pays.
  price_minor         bigint not null check (price_minor > 0),
  -- Purchase terms the brand states to the room (e.g. "Room members only,
  -- ships next week, before the public drop"). Free text, shown on the card.
  terms               text,
  -- Optional cap on units sold through THIS offer (null = uncapped). Enforced
  -- at order creation against settled purchases carrying this offer's id.
  qty_cap             integer check (qty_cap is null or qty_cap > 0),
  status              text not null default 'active' check (status in ('active', 'withdrawn')),
  created_by_platform text not null,
  created_by_type     text not null,
  created_by_ref      text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_app_room_offers_room
  on app_room_offers (room_id) where status = 'active';

alter table app_room_offers enable row level security;

-- Link a purchase back to the room offer it came through, so the offer's sold
-- count (and cap) is queryable and the order is auditable as room commerce.
alter table app_purchases
  add column if not exists room_offer_id uuid references app_room_offers(id);

create index if not exists idx_app_purchases_room_offer
  on app_purchases (room_offer_id) where room_offer_id is not null;
