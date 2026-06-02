-- migrations/0015_store_agent_key.sql
--
-- Agent-native product management key.
--
-- Once a store is authorised (approval_status='approved', active=true) and has
-- a human contact_email on record, the owning agent can manage its catalogue
-- WITHOUT the dashboard session cookie. It exchanges the email + password it
-- set at register_store (POST /api/sellers/[slug]/agent/auth) for a store key,
-- then calls the management MCP at /sellers/[slug]/manage/mcp with that key in
-- the x-via-store-key header.
--
-- We store only a SHA-256 hash of the key, never the plaintext. The plaintext
-- is returned exactly once, at the auth exchange, and is re-minted (rotated) on
-- each successful exchange. A leaked DB row therefore cannot be replayed as a
-- management credential.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0015_store_agent_key.sql
-- Or via the Supabase dashboard SQL editor.

begin;

alter table app_sellers
  add column if not exists agent_api_key_hash text;

comment on column app_sellers.agent_api_key_hash is
  'SHA-256 hash of the current store management key (via_sk_...). Minted/rotated by POST /api/sellers/[slug]/agent/auth after email+password auth; verified by the management MCP (x-via-store-key). Plaintext is never stored. Null = no key issued yet.';

commit;
