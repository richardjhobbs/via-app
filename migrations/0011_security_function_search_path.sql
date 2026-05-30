-- via-app security hardening (review finding L6).
--
-- Supabase advisor warns that seven public functions have a "role mutable
-- search_path" (function_search_path_mutable, level WARN). A function with no
-- pinned search_path resolves unqualified object names against whatever
-- search_path the calling role happens to have, which is the classic vector
-- for search_path-based privilege/redirection attacks (an attacker who can
-- create an object in an earlier-resolved schema can shadow the one the
-- function meant to touch).
--
-- All seven are SECURITY INVOKER trigger/helper functions that only ever
-- reference objects in `public`, so we pin search_path to `public`. This
-- clears the advisor and removes the role-mutable behaviour without changing
-- any function body or breaking unqualified references inside them.
--
-- Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0011_security_function_search_path.sql
-- Or via the Supabase dashboard SQL editor.

begin;

alter function public.app_generate_order_ref()                set search_path = public;
alter function public.app_set_updated_at()                    set search_path = public;
alter function public.classify_intent_topics(input_text text) set search_path = public;
alter function public.intents_set_topics()                    set search_path = public;
alter function public.kb_access_set_topics()                  set search_path = public;
alter function public.via_agent_actions_append_only()         set search_path = public;
alter function public.via_append_action(
  p_via_agent_id   bigint,
  p_source_platform text,
  p_action_type    text,
  p_target         text,
  p_payload_hash   text,
  p_payload        jsonb,
  p_nonce          bigint,
  p_signer_wallet  text,
  p_signed_message text,
  p_signature      text,
  p_sig_scheme     text
) set search_path = public;

commit;
