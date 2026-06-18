-- 0026_erc8004_signal_queue.sql
--
-- Durable, nonce-safe queue for ERC-8004 reputation signals emitted when a seller
-- pays the per-item micro-fee at the brief door. The door ENQUEUES one row per
-- agent (seller, and buyer when registered); a serialized cron drainer posts each
-- on-chain one at a time with sequential deployer nonces, so concurrent door
-- requests on serverless never collide on the gas-wallet nonce.

create table if not exists app_erc8004_signal_queue (
  id              uuid primary key default gen_random_uuid(),
  agent_id        text not null,                 -- ERC-8004 agent id (numeric string)
  role            text not null check (role in ('buyer', 'seller')),
  order_ref       text not null,                 -- e.g. brief-<intent>-<payment_tx>
  tx_hash         text not null,                 -- the micro-fee payment tx (reputation anchor)
  status          text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts        int  not null default 0,
  signal_tx_hash  text,                          -- the posted reputation tx, once done
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One signal per (order, agent, role): re-polling / retries never double-post.
create unique index if not exists uq_erc8004_queue_dedup
  on app_erc8004_signal_queue (order_ref, agent_id, role);

-- Drainer reads the oldest pending rows first.
create index if not exists idx_erc8004_queue_pending
  on app_erc8004_signal_queue (created_at)
  where status = 'pending';
