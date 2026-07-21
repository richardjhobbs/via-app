-- 0056_room_offers_rrg.sql
-- Extend in-room offers to RRG brands, the room's native membership. An RRG
-- brand member offers one of its RRG drops at a room price; VIA collects the
-- member's USDC through its gasless permit rail into the SHARED platform
-- wallet and settles on RRG (/api/rrg/claim) with a signed price
-- authorization, so mint, delivery, and brand payout run on RRG as a normal
-- sale at the room price.
--
-- app_room_offers grows a platform discriminator plus the RRG product pointer
-- and a display snapshot (RRG product data lives on the other platform, so the
-- card renders from the snapshot). VIA-store offers keep seller_id/product_id;
-- RRG offers carry brand_slug/rrg_token_id.
--
-- app_room_offer_orders is the local ledger for RRG-offer purchases (VIA-store
-- offers stay ledgered in app_purchases): the pending order, the permit
-- payment tx, and the RRG claim receipt, so settlement is recoverable and the
-- offer cap countable.
--
-- Run: psql $SUPABASE_DB_URL -f migrations/0056_room_offers_rrg.sql

alter table app_room_offers
  alter column seller_id drop not null,
  alter column product_id drop not null,
  add column if not exists member_platform text not null default 'via',
  add column if not exists brand_slug text,
  add column if not exists rrg_token_id bigint,
  add column if not exists title text,
  add column if not exists image_url text,
  add column if not exists list_price_minor bigint,
  add column if not exists is_physical boolean,
  add column if not exists sizes jsonb,
  add column if not exists brand_name text;

alter table app_room_offers
  add constraint app_room_offers_platform_shape check (
    (member_platform = 'via' and seller_id is not null and product_id is not null)
    or
    (member_platform = 'rrg' and brand_slug is not null and rrg_token_id is not null and title is not null and list_price_minor is not null)
  );

create table if not exists app_room_offer_orders (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null references app_room_offers(id) on delete cascade,
  room_id         uuid not null references app_rooms(id) on delete cascade,
  buyer_wallet    text not null,
  member_platform text not null,
  member_type     text not null,
  member_ref      text not null,
  qty             integer not null default 1,
  total_usdc      numeric not null,
  email           text,
  delivery        jsonb,
  selected_size   text,
  -- pending -> paid (USDC pulled, claim not yet confirmed) -> settled.
  -- A paid-but-unclaimed order retries the claim with the same tx hash.
  status          text not null default 'pending' check (status in ('pending', 'paid', 'settled', 'failed')),
  payment_tx_hash text,
  rrg_receipt     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_app_room_offer_orders_offer
  on app_room_offer_orders (offer_id);

alter table app_room_offer_orders enable row level security;
