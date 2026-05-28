-- via-app: distinct agent wallet (thirdweb inAppWallet) per seller / buyer.
-- Applied via Supabase MCP on 2026-05-28; kept here for reproducibility.

alter table app_sellers add column if not exists agent_wallet_address text;
alter table app_buyers  add column if not exists agent_wallet_address text;

comment on column app_sellers.agent_wallet_address is
  'The Sales Agent''s own EOA (separate from the seller''s payout wallet). Recorded as agentWallet in the ERC-8004 registration JSON. Provisioned via thirdweb inAppWallet tied to the seller''s Supabase auth.';
comment on column app_buyers.agent_wallet_address is
  'The Buying Agent''s own EOA (separate from the buyer''s funding wallet). Recorded as agentWallet in the ERC-8004 registration JSON. Provisioned via thirdweb inAppWallet tied to the buyer''s Supabase auth.';

create index if not exists app_sellers_agent_wallet_idx on app_sellers (agent_wallet_address) where agent_wallet_address is not null;
create index if not exists app_buyers_agent_wallet_idx  on app_buyers  (agent_wallet_address) where agent_wallet_address is not null;
