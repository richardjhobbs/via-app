-- 0037_room_agent_wallet.sql
--
-- A Back Room is an MCP-autonomous entity: the central runtime acts and (later)
-- signs for it, so per the platform wallet rule its identity wallet is
-- platform-derived (deriveAgentWallet(room_id) from AGENT_WALLET_SEED), the same
-- way seller agents are, NOT a human in-app wallet. This holds the room's
-- identity now and is the wallet room-funded errands will settle from when
-- payments are wired. The address is stored for audit; the key is re-derivable
-- and never stored at rest.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0037_room_agent_wallet.sql

alter table app_rooms add column if not exists agent_wallet_address text;

create index if not exists idx_app_rooms_agent_wallet
  on app_rooms (agent_wallet_address) where agent_wallet_address is not null;
