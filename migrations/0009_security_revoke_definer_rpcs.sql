-- via-app security hardening (review finding H4).
--
-- The SECURITY DEFINER RPCs below run with the definer's (table-owner)
-- privileges and bypass RLS by design, so the in-app chat kit can read/write
-- memories with just a slug/handle context. By default Postgres grants EXECUTE
-- on functions to PUBLIC, so the Supabase anon role (the public key that ships
-- to browsers) can call them directly via /rest/v1/rpc/<name>. That lets an
-- unauthenticated caller:
--   - read or mutate ANY seller's / buyer's memories by passing any slug/handle
--     (the functions only scope by the supplied slug, not by auth.uid()), and
--   - burn token_ids from the shared edition sequence (app_next_token_id).
--
-- This migration removes EXECUTE from PUBLIC / anon / authenticated and grants
-- it back ONLY to service_role. The app connects as service_role (it uses
-- SUPABASE_SERVICE_ROLE_KEY), and every call site goes through the server-side
-- `db` client (verified: lib/app/sales-agent.ts, lib/app/buying-agent.ts,
-- app/buyers/[handle]/mcp, app/buyer/[handle]/admin/preferences, the
-- sales-agent / buying-agent API routes, and the publish route). No browser
-- code calls these RPCs with the anon key, so the app is unaffected.
--
-- NOTE: service_role normally inherits EXECUTE via PUBLIC, so revoking from
-- PUBLIC alone would also lock out the app. The explicit GRANT ... TO
-- service_role after each REVOKE is required, not optional.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0009_security_revoke_definer_rpcs.sql
-- Or via the Supabase dashboard SQL editor.

begin;

-- ── Seller memory RPCs (0001_app_init.sql) ───────────────────────────
revoke execute on function app_seller_memory_list(text, text, text, boolean, integer) from public, anon, authenticated;
grant  execute on function app_seller_memory_list(text, text, text, boolean, integer) to service_role;

revoke execute on function app_seller_memory_upsert(text, text, text, text, jsonb, text[], timestamptz, uuid) from public, anon, authenticated;
grant  execute on function app_seller_memory_upsert(text, text, text, text, jsonb, text[], timestamptz, uuid) to service_role;

revoke execute on function app_seller_memory_forget(text, uuid) from public, anon, authenticated;
grant  execute on function app_seller_memory_forget(text, uuid) to service_role;

-- ── Buyer memory RPCs (0002_buyer_memory_rpcs.sql) ───────────────────
revoke execute on function app_buyer_memory_list(text, text, text, integer) from public, anon, authenticated;
grant  execute on function app_buyer_memory_list(text, text, text, integer) to service_role;

revoke execute on function app_buyer_memory_upsert(text, text, text, text, jsonb, text[], uuid) from public, anon, authenticated;
grant  execute on function app_buyer_memory_upsert(text, text, text, text, jsonb, text[], uuid) to service_role;

revoke execute on function app_buyer_memory_forget(text, uuid) from public, anon, authenticated;
grant  execute on function app_buyer_memory_forget(text, uuid) to service_role;

-- ── Token-id sequence RPC (0001_app_init.sql) ────────────────────────
revoke execute on function app_next_token_id() from public, anon, authenticated;
grant  execute on function app_next_token_id() to service_role;

commit;
