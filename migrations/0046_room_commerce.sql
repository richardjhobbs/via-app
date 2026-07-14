-- 0046_room_commerce.sql
--
-- The exit ramp: a Back Room co-creates a product and sells it on VIA, with the
-- revenue split (after the platform 2.5%) locked to each participant's wallet.
--
--   app_sellers.room_id            , the store this room graduated into.
--   app_product_cocreators         , the LOCKED split agreement for a product:
--                                    each participant, their payout wallet, and
--                                    their share (pct of the seller take, summing
--                                    to 100). Presence of rows = this product
--                                    pays a co-creation split instead of a single
--                                    seller.
--   app_distribution_recipients    , one row per paid leg of a settled sale, so a
--                                    multi-wallet payout has a full record (the
--                                    parent app_distributions row holds one
--                                    seller_tx_hash only).
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0046_room_commerce.sql

-- A store that graduated out of a room. Nullable: most stores are not room-born.
alter table app_sellers
  add column if not exists room_id uuid references app_rooms(id) on delete set null;
create index if not exists idx_app_sellers_room on app_sellers (room_id) where room_id is not null;

-- The locked split agreement. pct is a share of the SELLER take (after platform
-- 2.5%); the rows for a product sum to 100. Immutable once the product is live.
create table if not exists app_product_cocreators (
  id               uuid        primary key default gen_random_uuid(),
  product_id       uuid        not null references app_seller_products(id) on delete cascade,
  member_platform  text        not null check (member_platform in ('via','rrg')),
  member_type      text        not null check (member_type in ('buyer','seller')),
  member_ref       text        not null,
  payout_wallet    text        not null,          -- resolved + locked at agreement
  pct              numeric(5,2) not null check (pct > 0 and pct <= 100),
  role             text        not null default 'co-creator',
  locked_at        timestamptz not null default now()
);
create index if not exists idx_app_product_cocreators_product on app_product_cocreators (product_id);

alter table app_product_cocreators enable row level security;
-- No public policies: only the service role reads/writes the split agreement.

-- One row per paid leg of a settled sale. A single-seller sale has one leg; a
-- co-creation sale has one per participant.
create table if not exists app_distribution_recipients (
  id               uuid        primary key default gen_random_uuid(),
  distribution_id  uuid        not null references app_distributions(id) on delete cascade,
  wallet           text        not null,
  usdc             numeric(18,6) not null,
  role             text        not null default 'co-creator',
  tx_hash          text,
  status           text        not null default 'pending' check (status in ('pending','paid','failed')),
  created_at       timestamptz not null default now()
);
create index if not exists idx_app_distribution_recipients_dist on app_distribution_recipients (distribution_id);

alter table app_distribution_recipients enable row level security;
-- No public policies: only the service role reads/writes payout legs.
