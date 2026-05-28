-- via-app: initial schema for Sales Agent (Stage 1) + Buying Agent (Stage 2).
--
-- Target database: the existing `via-agent-mcp` Supabase project (shared with
-- getvia.xyz's `api/_via-tools.js` so sellers can mint ERC-8004 identity via
-- the existing via_register_agent tool without cross-project joins).
--
-- All tables are prefixed `app_` to keep them clearly separate from the
-- protocol-primitive tables already in that project (agent identity,
-- platform grants, memory events).
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0001_app_init.sql
-- Or via the Supabase dashboard SQL editor (paste in full).

begin;

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────
-- Sequence for ERC-1155 token IDs (globally unique across all sellers)
-- ─────────────────────────────────────────────────────────────────────

create sequence if not exists app_token_id_seq
  start with 1
  increment by 1
  no cycle;

-- ─────────────────────────────────────────────────────────────────────
-- Stage 1: Sellers (Sales Agents)
-- ─────────────────────────────────────────────────────────────────────

create table app_sellers (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  kind                text not null check (kind in ('product', 'service', 'mixed')),
  contact_email       text not null,
  owner_user_id       uuid not null references auth.users(id) on delete restrict,
  website_url         text,
  description         text,
  headline            text,
  shopify_domain      text,
  wallet_address      text not null,             -- Base wallet for USDC payouts
  erc8004_seller_id   text,                      -- ERC-8004 ID for the seller entity
  erc8004_agent_id    text,                      -- ERC-8004 ID for the Sales Agent
  seller_pct_override numeric(5,2),              -- optional split override (0..100)
  active              boolean not null default true,
  tc_accepted_at      timestamptz,
  tc_version          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index app_sellers_owner_user_id_idx on app_sellers (owner_user_id);
create index app_sellers_active_idx on app_sellers (active) where active = true;

-- ─────────────────────────────────────────────────────────────────────
-- Seller products / listings
-- ─────────────────────────────────────────────────────────────────────

create table app_seller_products (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references app_sellers(id) on delete cascade,
  external_id       text,                              -- Shopify product ID or null
  kind              text not null check (kind in ('physical', 'digital', 'service')),
  title             text not null,
  description       text,
  price_minor       bigint not null,                   -- price in minor units (USDC cents: 6 decimals)
  currency          text not null default 'USDC',
  stock             integer,                           -- nullable for unlimited
  url               text,
  image_url         text,
  metadata          jsonb not null default '{}'::jsonb,
  active            boolean not null default true,
  token_id          bigint unique,                     -- ERC-1155 token id (assigned at registerDrop)
  max_supply        integer,                           -- on-chain edition; null = use 1e9 sentinel
  on_chain_status   text not null default 'draft'
                      check (on_chain_status in ('draft', 'registered', 'paused', 'sold_out')),
  on_chain_tx_hash  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index app_seller_products_seller_external_idx
  on app_seller_products (seller_id, external_id)
  where external_id is not null;

create index app_seller_products_seller_active_idx
  on app_seller_products (seller_id) where active = true;

create index app_seller_products_token_id_idx
  on app_seller_products (token_id) where token_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- Sales Agent memories — voice block + everything the agent should
-- remember to surface to buyers. Port of rrg_brand_memories.
-- ─────────────────────────────────────────────────────────────────────

create table app_seller_memories (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references app_sellers(id) on delete cascade,
  type          text not null check (type in ('event', 'stock_note', 'promotion', 'brand_update', 'policy', 'general')),
  title         text not null,
  body          text not null,
  structured    jsonb not null default '{}'::jsonb,
  tags          text[] not null default '{}',
  valid_from    timestamptz not null default now(),
  valid_until   timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create index app_seller_memories_seller_idx
  on app_seller_memories (seller_id, active) where active = true;
create index app_seller_memories_tags_idx
  on app_seller_memories using gin (tags);
create index app_seller_memories_valid_until_idx
  on app_seller_memories (valid_until) where valid_until is not null;

-- ─────────────────────────────────────────────────────────────────────
-- Conversations + messages (admin chat with Sales Agent, agent-to-agent
-- MCP exchanges, superadmin overrides)
-- ─────────────────────────────────────────────────────────────────────

create table app_seller_conversations (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references app_sellers(id) on delete cascade,
  source        text not null check (source in ('admin_chat', 'agent_mcp', 'superadmin_chat')),
  actor_label   text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index app_seller_conversations_seller_idx
  on app_seller_conversations (seller_id, started_at desc);

create table app_seller_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references app_seller_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         text not null,
  tool_calls      jsonb,
  created_at      timestamptz not null default now()
);

create index app_seller_messages_conv_idx
  on app_seller_messages (conversation_id, created_at);

-- ─────────────────────────────────────────────────────────────────────
-- Purchases + distributions (on-chain mint + 97.5/2.5 payout records)
-- ─────────────────────────────────────────────────────────────────────

create table app_purchases (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references app_seller_products(id) on delete restrict,
  seller_id         uuid not null references app_sellers(id) on delete restrict,
  buyer_wallet      text not null,
  buyer_agent_id    text,                              -- ERC-8004 ID of the Buying Agent
  qty               integer not null default 1,
  total_usdc        numeric(18,6) not null,
  payment_method    text not null check (payment_method in ('x402_permit', 'x402_operator')),
  mint_tx_hash      text,
  payout_tx_hash    text,
  status            text not null default 'pending'
                      check (status in ('pending', 'paid', 'minted', 'paid_out', 'failed')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index app_purchases_seller_idx on app_purchases (seller_id, created_at desc);
create index app_purchases_product_idx on app_purchases (product_id, created_at desc);
create index app_purchases_buyer_wallet_idx on app_purchases (buyer_wallet);

create table app_distributions (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references app_purchases(id) on delete restrict,
  seller_id       uuid not null references app_sellers(id) on delete restrict,
  total_usdc      numeric(18,6) not null,
  seller_usdc     numeric(18,6) not null,
  platform_usdc   numeric(18,6) not null,
  split_type      text not null default 'seller_product_tiered',
  seller_tx_hash  text,
  status          text not null default 'pending'
                    check (status in ('pending', 'paid', 'failed')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index app_distributions_seller_idx on app_distributions (seller_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- MCP interactions log (port of rrg_mcp_interactions)
-- ─────────────────────────────────────────────────────────────────────

create table app_mcp_interactions (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid references app_sellers(id) on delete cascade,
  buyer_id        uuid,                                -- forward ref to app_buyers (Stage 2)
  tool_name       text not null,
  agent_identity  jsonb not null default '{}'::jsonb,
  request         jsonb,
  response        jsonb,
  status_code     integer,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);

create index app_mcp_interactions_seller_idx
  on app_mcp_interactions (seller_id, created_at desc) where seller_id is not null;
create index app_mcp_interactions_buyer_idx
  on app_mcp_interactions (buyer_id, created_at desc) where buyer_id is not null;
create index app_mcp_interactions_tool_idx
  on app_mcp_interactions (tool_name, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Stage 2: Buyers (Buying Agents)
-- ─────────────────────────────────────────────────────────────────────

create table app_buyers (
  id                  uuid primary key default gen_random_uuid(),
  handle              text not null unique,
  owner_user_id       uuid not null references auth.users(id) on delete restrict,
  display_name        text,
  public              boolean not null default false,
  wallet_address      text not null,                 -- Base wallet for x402 payments
  erc8004_buyer_id    text,                          -- ERC-8004 ID for the buyer entity
  erc8004_agent_id    text,                          -- ERC-8004 ID for the Buying Agent
  delegation_caps     jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index app_buyers_owner_user_id_idx on app_buyers (owner_user_id);

create table app_buyer_memories (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      uuid not null references app_buyers(id) on delete cascade,
  type          text not null,
  title         text not null,
  body          text not null,
  structured    jsonb not null default '{}'::jsonb,
  tags          text[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create index app_buyer_memories_buyer_idx
  on app_buyer_memories (buyer_id, active) where active = true;
create index app_buyer_memories_tags_idx
  on app_buyer_memories using gin (tags);

create table app_buyer_conversations (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      uuid not null references app_buyers(id) on delete cascade,
  source        text not null check (source in ('owner_chat', 'agent_mcp', 'superadmin_chat')),
  counterparty  text,                                -- seller slug or agent id
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index app_buyer_conversations_buyer_idx
  on app_buyer_conversations (buyer_id, started_at desc);

create table app_buyer_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references app_buyer_conversations(id) on delete cascade,
  role            text not null,
  content         text not null,
  tool_calls      jsonb,
  feedback        text check (feedback in ('good', 'bad')),
  created_at      timestamptz not null default now()
);

create index app_buyer_messages_conv_idx
  on app_buyer_messages (conversation_id, created_at);

create table app_buyer_intents (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      uuid not null references app_buyers(id) on delete cascade,
  intent_text   text not null,
  structured    jsonb not null default '{}'::jsonb,
  status        text not null default 'open'
                  check (status in ('open', 'broadcast', 'matched', 'resolved', 'cancelled')),
  broadcast_at  timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index app_buyer_intents_buyer_idx on app_buyer_intents (buyer_id, status);

-- Now that app_buyers exists, add the FK from app_mcp_interactions.buyer_id.
alter table app_mcp_interactions
  add constraint app_mcp_interactions_buyer_fk
  foreign key (buyer_id) references app_buyers(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────
-- RPCs: Sales Agent memory tools (called by lib/app/sales-agent.ts)
-- These wrap RLS-bypassing service-role logic so the chat tool kit can
-- read/write memories with just a slug context.
-- ─────────────────────────────────────────────────────────────────────

create or replace function app_seller_memory_list(
  p_slug              text,
  p_type              text default null,
  p_tag               text default null,
  p_include_expired   boolean default false,
  p_limit             integer default 100
) returns setof app_seller_memories
language plpgsql security definer set search_path = public
as $$
declare
  v_seller_id uuid;
begin
  select id into v_seller_id from app_sellers where slug = p_slug;
  if v_seller_id is null then
    return;
  end if;
  return query
    select * from app_seller_memories
    where seller_id = v_seller_id
      and active
      and (p_type is null or type = p_type)
      and (p_tag  is null or p_tag = any (tags))
      and (p_include_expired or valid_until is null or valid_until > now())
    order by created_at desc
    limit p_limit;
end;
$$;

create or replace function app_seller_memory_upsert(
  p_slug          text,
  p_type          text,
  p_title         text,
  p_body          text,
  p_structured    jsonb default '{}'::jsonb,
  p_tags          text[] default '{}',
  p_valid_until   timestamptz default null,
  p_id            uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_seller_id uuid;
  v_memory_id uuid;
begin
  select id into v_seller_id from app_sellers where slug = p_slug;
  if v_seller_id is null then
    raise exception 'app_seller_memory_upsert: unknown seller slug %', p_slug;
  end if;

  if p_id is not null then
    update app_seller_memories
      set type = p_type, title = p_title, body = p_body,
          structured = p_structured, tags = p_tags, valid_until = p_valid_until,
          active = true
      where id = p_id and seller_id = v_seller_id
      returning id into v_memory_id;
    if v_memory_id is null then
      raise exception 'app_seller_memory_upsert: memory % not owned by seller %', p_id, p_slug;
    end if;
  else
    insert into app_seller_memories (seller_id, type, title, body, structured, tags, valid_until)
      values (v_seller_id, p_type, p_title, p_body, p_structured, p_tags, p_valid_until)
      returning id into v_memory_id;
  end if;

  return v_memory_id;
end;
$$;

create or replace function app_seller_memory_forget(
  p_slug  text,
  p_id    uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_seller_id uuid;
  v_rows      integer;
begin
  select id into v_seller_id from app_sellers where slug = p_slug;
  if v_seller_id is null then
    return false;
  end if;
  update app_seller_memories set active = false
    where id = p_id and seller_id = v_seller_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Convenience: returns the next ERC-1155 token id (used by the publish flow).
create or replace function app_next_token_id() returns bigint
language sql security definer set search_path = public
as $$
  select nextval('app_token_id_seq');
$$;

-- ─────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────

create or replace function app_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_sellers_set_updated_at
  before update on app_sellers
  for each row execute function app_set_updated_at();

create trigger app_seller_products_set_updated_at
  before update on app_seller_products
  for each row execute function app_set_updated_at();

create trigger app_purchases_set_updated_at
  before update on app_purchases
  for each row execute function app_set_updated_at();

create trigger app_buyers_set_updated_at
  before update on app_buyers
  for each row execute function app_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- Owner-scoped: a user can only see/modify their own seller(s) and the
-- rows linked to them. Service-role bypasses everything (used by MCP
-- routes and superadmin).
-- ─────────────────────────────────────────────────────────────────────

alter table app_sellers              enable row level security;
alter table app_seller_products      enable row level security;
alter table app_seller_memories      enable row level security;
alter table app_seller_conversations enable row level security;
alter table app_seller_messages      enable row level security;
alter table app_purchases            enable row level security;
alter table app_distributions        enable row level security;
alter table app_mcp_interactions     enable row level security;
alter table app_buyers               enable row level security;
alter table app_buyer_memories       enable row level security;
alter table app_buyer_conversations  enable row level security;
alter table app_buyer_messages       enable row level security;
alter table app_buyer_intents        enable row level security;

-- app_sellers: owner reads + updates their row; INSERT goes through service-role
create policy "sellers_owner_select" on app_sellers
  for select using (owner_user_id = auth.uid());
create policy "sellers_owner_update" on app_sellers
  for update using (owner_user_id = auth.uid());

-- Children of app_sellers: owner scope through join
create policy "seller_products_owner_all" on app_seller_products
  for all using (
    exists (select 1 from app_sellers s
            where s.id = app_seller_products.seller_id and s.owner_user_id = auth.uid())
  );

create policy "seller_memories_owner_all" on app_seller_memories
  for all using (
    exists (select 1 from app_sellers s
            where s.id = app_seller_memories.seller_id and s.owner_user_id = auth.uid())
  );

create policy "seller_conversations_owner_all" on app_seller_conversations
  for all using (
    exists (select 1 from app_sellers s
            where s.id = app_seller_conversations.seller_id and s.owner_user_id = auth.uid())
  );

create policy "seller_messages_owner_all" on app_seller_messages
  for all using (
    exists (select 1
            from app_seller_conversations c
            join app_sellers s on s.id = c.seller_id
            where c.id = app_seller_messages.conversation_id and s.owner_user_id = auth.uid())
  );

create policy "purchases_owner_select" on app_purchases
  for select using (
    exists (select 1 from app_sellers s
            where s.id = app_purchases.seller_id and s.owner_user_id = auth.uid())
  );

create policy "distributions_owner_select" on app_distributions
  for select using (
    exists (select 1 from app_sellers s
            where s.id = app_distributions.seller_id and s.owner_user_id = auth.uid())
  );

create policy "mcp_interactions_owner_select" on app_mcp_interactions
  for select using (
    (seller_id is not null and exists (select 1 from app_sellers s
                                       where s.id = app_mcp_interactions.seller_id and s.owner_user_id = auth.uid()))
    or
    (buyer_id is not null and exists (select 1 from app_buyers b
                                      where b.id = app_mcp_interactions.buyer_id and b.owner_user_id = auth.uid()))
  );

-- Buyer-side policies (Stage 2)
create policy "buyers_owner_select" on app_buyers
  for select using (owner_user_id = auth.uid() or public);
create policy "buyers_owner_update" on app_buyers
  for update using (owner_user_id = auth.uid());

create policy "buyer_memories_owner_all" on app_buyer_memories
  for all using (
    exists (select 1 from app_buyers b
            where b.id = app_buyer_memories.buyer_id and b.owner_user_id = auth.uid())
  );

create policy "buyer_conversations_owner_all" on app_buyer_conversations
  for all using (
    exists (select 1 from app_buyers b
            where b.id = app_buyer_conversations.buyer_id and b.owner_user_id = auth.uid())
  );

create policy "buyer_messages_owner_all" on app_buyer_messages
  for all using (
    exists (select 1
            from app_buyer_conversations c
            join app_buyers b on b.id = c.buyer_id
            where c.id = app_buyer_messages.conversation_id and b.owner_user_id = auth.uid())
  );

create policy "buyer_intents_owner_all" on app_buyer_intents
  for all using (
    exists (select 1 from app_buyers b
            where b.id = app_buyer_intents.buyer_id and b.owner_user_id = auth.uid())
  );

commit;
