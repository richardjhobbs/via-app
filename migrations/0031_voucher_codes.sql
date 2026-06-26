-- 0031_voucher_codes.sql
--
-- Per-buyer unique redemption codes for the ticketing / event channel.
--
-- The existing digital-delivery path (lib/app/digital-delivery.ts) signs URLs to
-- a product's SHARED file set: correct for an ebook, wrong for an event pass,
-- where buyer A and buyer B must each receive a DIFFERENT code (e.g. a Luma
-- redemption code) and no buyer ever sees another's. This table is a pool of
-- codes per product (one product = one pass tier); app_claim_voucher() hands out
-- exactly one available code per claim, atomically, at settlement.
--
-- Tier stock = count of rows with status='available'; the tier reads sold out
-- when the pool empties, and loading more rows restocks it. No other inventory
-- bookkeeping is needed.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0031_voucher_codes.sql
-- Or via the Supabase dashboard SQL editor.

create table if not exists app_voucher_codes (
  id                  uuid        primary key default gen_random_uuid(),
  seller_id           uuid        not null references app_sellers(id) on delete cascade,
  product_id          uuid        not null references app_seller_products(id) on delete cascade,
  code                text        not null,
  status              text        not null default 'available'
                        check (status in ('available', 'claimed', 'void')),
  claimed_by_purchase uuid        references app_purchases(id),
  claimed_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (product_id, code)                       -- no duplicate codes within a tier
);

-- Fast "next available" pick and remaining-stock count, scoped per product.
create index if not exists idx_app_voucher_codes_available
  on app_voucher_codes (product_id, created_at)
  where status = 'available';

-- One purchase's claimed codes (idempotent re-claim + delivery lookup).
create index if not exists idx_app_voucher_codes_purchase
  on app_voucher_codes (claimed_by_purchase)
  where claimed_by_purchase is not null;

alter table app_voucher_codes enable row level security;
-- No public policies: only the service role (server) reads/writes the pool.

-- Atomically claim one available code for a purchase. FOR UPDATE SKIP LOCKED so
-- two concurrent settlements never grab the same code; returns the claimed code,
-- or null when the pool is empty (caller treats null as sold out).
create or replace function app_claim_voucher(p_product_id uuid, p_purchase_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_id   uuid;
  v_code text;
begin
  select id, code into v_id, v_code
    from app_voucher_codes
   where product_id = p_product_id
     and status = 'available'
   order by created_at
   for update skip locked
   limit 1;

  if v_id is null then
    return null;
  end if;

  update app_voucher_codes
     set status              = 'claimed',
         claimed_by_purchase = p_purchase_id,
         claimed_at          = now()
   where id = v_id;

  return v_code;
end;
$$;

-- SECURITY DEFINER: keep it off the public/anon/authenticated roles; the server
-- calls it with the service-role key (see migration 0009 for the convention).
revoke execute on function app_claim_voucher(uuid, uuid) from public, anon, authenticated;
grant  execute on function app_claim_voucher(uuid, uuid) to service_role;
