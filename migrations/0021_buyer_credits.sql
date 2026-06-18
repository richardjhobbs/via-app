-- migrations/0021_buyer_credits.sql
--
-- Concierge-style credits for Buying Agents, mirroring RRG's agent credits
-- (lib/agent/credits.ts + scripts/006-agent-credits-atomic.sql). USD-denominated
-- balance funds the buyer agent's DeepSeek usage (training chat + negotiate).
-- Display convention is 1 USD = 1,000 credits (lib/app/buyer-credits.ts).
--
-- Onboarding grants 1.0 USD (1,000 credits) as a welcome / CAC grant. Owners
-- top up by sending USDC on Base to the platform wallet
-- (POST /api/buyer/[buyerId]/credits/topup verifies the tx). No weekly cap (a
-- deliberate simplification vs RRG; the buyer agent is owner-driven, not
-- autonomous-burning).

alter table app_buyers
  add column if not exists credit_balance_usdc numeric(12,4) not null default 0;

-- Audit ledger , mirrors agent_credit_transactions.
create table if not exists app_buyer_credit_transactions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  buyer_id      uuid not null references app_buyers(id) on delete cascade,
  type          text not null check (type in ('topup', 'deduction', 'refund')),
  amount_usdc   numeric(12,6) not null,        -- signed: negative for deductions
  balance_after numeric(12,4) not null,
  description   text,
  tx_hash       text                            -- on-chain top-up reference (unique-ish, checked in app)
);

create index if not exists app_buyer_credit_tx_buyer_recent_idx
  on app_buyer_credit_transactions (buyer_id, created_at desc);

create index if not exists app_buyer_credit_tx_hash_idx
  on app_buyer_credit_transactions (tx_hash) where tx_hash is not null;

alter table app_buyer_credit_transactions enable row level security;

-- Owner-scoped reads (mirrors app_buyers owner-only posture, migration 0010).
-- Inserts are service-role only (no insert policy).
drop policy if exists app_buyer_credit_tx_owner_select on app_buyer_credit_transactions;
create policy app_buyer_credit_tx_owner_select on app_buyer_credit_transactions
  for select using (
    buyer_id in (select id from app_buyers where owner_user_id = auth.uid())
  );

-- Atomic balance mutations , prevents read-modify-write races on concurrent
-- chat turns and top-ups (mirrors RRG agent_credits_deduct/topup).
create or replace function app_buyer_credits_deduct(p_buyer_id uuid, p_cost numeric)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  update app_buyers
  set credit_balance_usdc = greatest(0, credit_balance_usdc - p_cost),
      updated_at = now()
  where id = p_buyer_id
  returning credit_balance_usdc into v_new_balance;

  if not found then
    raise exception 'Buyer not found: %', p_buyer_id;
  end if;

  return v_new_balance;
end;
$$;

create or replace function app_buyer_credits_topup(p_buyer_id uuid, p_amount numeric)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  update app_buyers
  set credit_balance_usdc = credit_balance_usdc + p_amount,
      updated_at = now()
  where id = p_buyer_id
  returning credit_balance_usdc into v_new_balance;

  if not found then
    raise exception 'Buyer not found: %', p_buyer_id;
  end if;

  return v_new_balance;
end;
$$;

-- Service-role + postgres only (callers all use the service-role client).
revoke execute on function app_buyer_credits_deduct(uuid, numeric) from anon, authenticated;
revoke execute on function app_buyer_credits_topup(uuid, numeric)  from anon, authenticated;
