-- 0039_room_member_wallet.sql
--
-- Cache each member's wallet on the membership row so a member of any of the
-- four kinds authenticates to the room the same way: sign the room challenge,
-- and the room resolves the signer against app_room_members.member_wallet.
--
-- The wallet is resolved once, at join:
--   via/buyer  -> app_buyers.wallet_address (the buyer's own in-app wallet)
--   via/seller -> app_sellers.agent_wallet_address (platform-derived)
--   rrg/*      -> supplied by the RRG side (the concierge's wallet), since RRG
--                is a separate project reached over HTTP; auto-fetched when RRG
--                exposes an identity endpoint, otherwise passed in explicitly.
-- This keeps wallet auth uniform without a per-request cross-platform lookup.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0039_room_member_wallet.sql

alter table app_room_members add column if not exists member_wallet text;

create index if not exists idx_app_room_members_wallet
  on app_room_members (room_id, lower(member_wallet)) where member_wallet is not null;
