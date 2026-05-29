-- migrations/0006_orders.sql
--
-- Lift app_purchases into a proper order record:
--   - order_ref: short human-readable code agents quote back ("VIA-2605-7K3PQM")
--   - delivery_address: structured PII for physical fulfilment
--   - purchase_policy: seller-supplied note returned by get_seller_info so
--     buyer agents know what to gather BEFORE calling buy_product
--
-- delivery_address is jsonb so the shipping block is one column / one render
-- and stays flexible per seller. RLS (when enabled on this table later) must
-- restrict it to the seller's owner_user_id.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- Order ref generator
-- ─────────────────────────────────────────────────────────────────────
-- Crockford base32 alphabet (no I, L, O, U) avoids buyer/agent confusion
-- when an order ref is read aloud or transcribed. 6 chars = 32^6 ≈ 1.07B
-- combinations, ample for v1; we add a unique constraint on the column so
-- a collision would surface as a server error rather than a silent overlap.

create or replace function app_generate_order_ref() returns text
language plpgsql as $$
declare
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  result text := 'VIA-' || to_char(now(), 'YYMM') || '-';
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
-- app_purchases additions
-- ─────────────────────────────────────────────────────────────────────

alter table app_purchases
  add column if not exists order_ref        text,
  add column if not exists delivery_address jsonb;

-- Backfill any rows that pre-date this migration (table is empty in v1
-- but keep the migration idempotent).
update app_purchases
  set order_ref = app_generate_order_ref()
  where order_ref is null;

-- Now safe to enforce.
alter table app_purchases
  alter column order_ref set default app_generate_order_ref(),
  alter column order_ref set not null;

create unique index if not exists app_purchases_order_ref_idx
  on app_purchases (order_ref);

-- ─────────────────────────────────────────────────────────────────────
-- app_sellers: purchase_policy
-- ─────────────────────────────────────────────────────────────────────
-- Short free-form note surfaced through get_seller_info(). Sellers use
-- this to tell buying agents what's required before they call buy_product
-- ("Physical orders require name, full address, postcode, phone").

alter table app_sellers
  add column if not exists purchase_policy text;

commit;
