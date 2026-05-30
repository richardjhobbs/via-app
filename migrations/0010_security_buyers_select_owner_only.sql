-- via-app security hardening (review finding M2).
--
-- The app_buyers SELECT policy "buyers_owner_select" was
--   ((owner_user_id = auth.uid()) OR public)
-- which lets the public anon PostgREST role read EVERY column of any buyer
-- row with public = true, directly at /rest/v1/app_buyers. That exposes
-- wallet_address, agent_wallet_address, and delegation_caps (the buyer's
-- spending limits) of every public buyer to anyone holding the anon key (which
-- ships to browsers).
--
-- Nothing depends on that anon read: every server path queries app_buyers
-- through the service-role `db` client (which bypasses RLS), scoped by
-- owner_user_id; the only public surface, /buyers/[handle]/mcp, also runs as
-- service-role and already strips PII and caps before returning anything. There
-- is no public buyer profile or directory page. So we drop the `OR public`
-- clause and restrict SELECT to the owner. Service-role reads are unaffected;
-- only direct anon/authenticated access to other buyers' rows is closed.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0010_security_buyers_select_owner_only.sql
-- Or via the Supabase dashboard SQL editor.

begin;

drop policy if exists "buyers_owner_select" on app_buyers;
create policy "buyers_owner_select" on app_buyers
  for select using (owner_user_id = auth.uid());

commit;
