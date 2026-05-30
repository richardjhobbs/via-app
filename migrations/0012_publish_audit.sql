-- via-app security hardening (review finding L7).
--
-- Publishing a product mints it on-chain (registerDrop on the VIA ERC-1155
-- contract) using the deployer wallet. That is an externally-visible,
-- value-bearing action, but until now nothing recorded WHO triggered it, WHEN,
-- and which token_id / tx it produced. lib/app/via-audit.ts exists for the
-- protocol-level signed-action chain, but that path needs a via-action-v1
-- signature from the agent's own (non-custodial) key, which the server does
-- not hold, so it cannot be driven from this server-side mint.
--
-- This adds a self-contained local audit trail: one append-only row per
-- successful publish, capturing the acting seller user, the product, the
-- token_id, the tx hash (or the TEST-skipped marker), and the economic terms
-- at mint time. RLS is enabled with no policy so the anon/authenticated
-- PostgREST roles get nothing; the app writes/reads it through the
-- service-role client (which bypasses RLS), matching app_seller_customer_notes.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0012_publish_audit.sql
-- Or via the Supabase dashboard SQL editor.

begin;

create table if not exists public.app_publish_audit (
  id            uuid primary key default gen_random_uuid(),
  seller_id     text not null,
  product_id    text not null,
  actor_user_id text,
  token_id      bigint,
  tx_hash       text,
  chain_skipped boolean not null default false,
  price_minor   bigint,
  max_supply    bigint,
  created_at    timestamptz not null default now()
);

create index if not exists app_publish_audit_seller_idx
  on public.app_publish_audit (seller_id, created_at desc);

alter table public.app_publish_audit enable row level security;

commit;
