-- 0028_via_micropayments.sql
--
-- Replay guard for the DIRECT-PAY fallback at the x402 brief door. An agent without
-- an x402 client can pay the micro-fee by sending USDC straight to the platform
-- wallet on Base, then presenting the tx hash (header X-PAYMENT-TX). We verify the
-- transfer on-chain and record the consumed tx here so one payment unlocks exactly
-- one resource , a tx hash can never be replayed across briefs/offers.
--
-- The x402-native path (signed receipt settled by the CDP facilitator) does NOT use
-- this table; the facilitator's own nonce handling prevents replay there.

create table if not exists app_via_micropayments (
  tx_hash      text primary key,
  payer_wallet text        not null,
  amount_usdc  numeric     not null,
  purpose      text        not null,             -- 'brief_unlock' | 'brief_offer'
  resource     text        not null,             -- the door URL the payment unlocked
  created_at   timestamptz not null default now()
);

create index if not exists idx_via_micropayments_payer on app_via_micropayments (payer_wallet);

alter table app_via_micropayments enable row level security;
-- No public policies: only the service role (server) reads/writes this guard.
