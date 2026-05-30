-- via-app security hardening (review finding C3).
--
-- app_seller_customer_notes was created in 0007_hermes.sql WITHOUT row level
-- security, unlike every other app_* table (see 0001_app_init.sql lines
-- 436-448). The table holds buyer PII (wallet, contact, free-text notes) keyed
-- to a seller. With RLS disabled, the public anon PostgREST role can read every
-- seller's customer notes directly at /rest/v1/app_seller_customer_notes.
--
-- This enables RLS and adds an owner-scoped policy mirroring
-- "seller_memories_owner_all" from 0001. The app itself uses the service-role
-- key (which bypasses RLS), so server reads/writes are unaffected; only direct
-- anon/authenticated access is closed.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0008_security_rls_customer_notes.sql
-- Or via the Supabase dashboard SQL editor.

begin;

alter table app_seller_customer_notes enable row level security;

-- Owner of the seller row may see/manage its customer notes. Anyone else
-- (anon, other authenticated users) is denied. Service-role bypasses RLS.
drop policy if exists "seller_customer_notes_owner_all" on app_seller_customer_notes;
create policy "seller_customer_notes_owner_all" on app_seller_customer_notes
  for all using (exists (select 1 from app_sellers s
            where s.id = app_seller_customer_notes.seller_id
              and s.owner_user_id = auth.uid()));

commit;
