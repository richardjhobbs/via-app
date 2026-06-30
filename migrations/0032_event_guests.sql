-- 0032_event_guests.sql
--
-- Guest list for the FREE event-pass channel.
--
-- Some event partners run free RSVP events (e.g. on Luma's free tier, with no
-- Luma Plus API key). For those there is nothing to settle and no redemption
-- code to hand out: the "pass" is simply a confirmed place on a guest list that
-- the organiser admits people from. This table is that list.
--
-- A guest_list tier (one app_seller_products row, metadata.fulfilment.mode =
-- 'guest_list', price_minor = 0) holds its remaining allocation on the existing
-- products.stock column. app_claim_event_seat() does the whole claim atomically:
-- it dedupes (one pass per email / per buyer account), decrements the allocation,
-- and inserts the guest row, so concurrent claims can never oversell or double
-- claim. There is NO x402 settlement, NO payout, and NO mint on this path.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0032_event_guests.sql
-- Or via the Supabase dashboard SQL editor.

create table if not exists app_event_guests (
  id             uuid        primary key default gen_random_uuid(),
  seller_id      uuid        not null references app_sellers(id)          on delete cascade,
  product_id     uuid        not null references app_seller_products(id)  on delete cascade,
  buyer_id       uuid        references app_buyers(id)                    on delete set null,
  name           text        not null,
  email          text        not null,           -- stored lower-cased (the dedup key)
  buyer_wallet   text,                            -- optional, when an external agent supplies one
  buyer_agent_id text,                            -- optional ERC-8004 id of the claiming agent
  source         text        not null default 'mcp_agent'
                   check (source in ('web_signup', 'mcp_agent')),
  status         text        not null default 'confirmed'
                   check (status in ('confirmed', 'cancelled')),
  claimed_at     timestamptz not null default now()
);

-- One pass per email per tier, and one pass per buyer account per tier. These
-- are the hard backstop behind the atomic claim function below.
create unique index if not exists uq_app_event_guests_product_email
  on app_event_guests (product_id, lower(email));
create unique index if not exists uq_app_event_guests_product_buyer
  on app_event_guests (product_id, buyer_id)
  where buyer_id is not null;

-- Organiser export / admin view: list a tier's (or an event's) guests newest first.
create index if not exists idx_app_event_guests_seller
  on app_event_guests (seller_id, claimed_at desc);

alter table app_event_guests enable row level security;
-- No public policies: only the service role (server) reads/writes the guest list.

-- Atomically claim a free seat for a guest. Locks the tier row so concurrent
-- claims serialise on the allocation, dedupes by email OR buyer account, and
-- inserts the guest row. Returns the guest id plus an outcome the caller maps to
-- a response:
--   'confirmed' : a new place on the guest list
--   'already'   : this email / account already holds a place (idempotent; no
--                 second seat consumed)
--   'sold_out'  : the tier allocation is exhausted
-- A null products.stock means unlimited allocation (never sells out).
create or replace function app_claim_event_seat(
  p_product_id     uuid,
  p_seller_id      uuid,
  p_email          text,
  p_name           text,
  p_buyer_id       uuid,
  p_buyer_wallet   text,
  p_buyer_agent_id text,
  p_source         text
) returns table (guest_id uuid, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  v_stock    integer;
  v_existing uuid;
  v_new      uuid;
begin
  -- Serialise concurrent claims for this tier on the allocation counter.
  select stock into v_stock from app_seller_products where id = p_product_id for update;

  -- Dedup: one per email, or one per buyer account, within this tier.
  select id into v_existing
    from app_event_guests
   where product_id = p_product_id
     and ( lower(email) = lower(p_email)
        or (p_buyer_id is not null and buyer_id = p_buyer_id) )
   limit 1;
  if v_existing is not null then
    return query select v_existing, 'already'::text;
    return;
  end if;

  -- Allocation cap (null stock = unlimited).
  if v_stock is not null and v_stock <= 0 then
    return query select null::uuid, 'sold_out'::text;
    return;
  end if;

  if v_stock is not null then
    update app_seller_products
       set stock = stock - 1, updated_at = now()
     where id = p_product_id;
  end if;

  insert into app_event_guests
    (seller_id, product_id, buyer_id, name, email, buyer_wallet, buyer_agent_id, source)
  values
    (p_seller_id, p_product_id, p_buyer_id, p_name, lower(p_email), p_buyer_wallet, p_buyer_agent_id, p_source)
  returning id into v_new;

  return query select v_new, 'confirmed'::text;
end;
$$;

-- SECURITY DEFINER: keep it off public/anon/authenticated; the server calls it
-- with the service-role key (matches migration 0009 / 0031 convention).
revoke execute on function app_claim_event_seat(uuid, uuid, text, text, uuid, text, text, text) from public, anon, authenticated;
grant  execute on function app_claim_event_seat(uuid, uuid, text, text, uuid, text, text, text) to service_role;
