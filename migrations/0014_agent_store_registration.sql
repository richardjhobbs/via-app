-- migrations/0014_agent_store_registration.sql
--
-- Agent self-serve store registration with a moderation window.
--
-- Until now a seller row could only be created by the web onboard wizard
-- (app/api/seller/auth/register), which provisions a thirdweb in-app wallet
-- for the Sales Agent and goes live (active=true) immediately. This migration
-- lets an autonomous agent register a store directly over the central MCP
-- (app.getvia.xyz/mcp register_store) using TWO of its OWN EOAs:
--   wallet_address       = the agent's payout wallet (USDC lands here)
--   agent_wallet_address = the agent's identity EOA (ERC-8004 holder)
-- No thirdweb dependency. The 2.5% network fee is unchanged: registerDrop is
-- always called with creator = PLATFORM_WALLET (see lib/app/splits.ts), so the
-- payout wallet the agent supplies never affects the split.
--
-- Agent-created stores DO NOT go live on submission. They land in a pending
-- state, invisible to list_sellers / find_seller / the per-seller MCP (all of
-- which already filter active=true), until a human reviews them inside the
-- 24-hour window for quality control (nothing illegal, immoral, or offensive).
-- On approval the store goes active and ONLY THEN is the ERC-8004 identity
-- minted, so rejected / spam submissions never spend registrar gas.
--
-- Lifecycle (approval_status):
--   null                 legacy / web onboard — implicitly live, never gated
--   'pending'            submitted by an agent, awaiting review
--   'approved'           passed review, active=true, ERC-8004 minted
--   'rejected:<reason>'  failed review, stays active=false
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0014_agent_store_registration.sql
-- Or via the Supabase dashboard SQL editor.

begin;

alter table app_sellers
  add column if not exists approval_status      text,
  add column if not exists created_via          text,
  add column if not exists submitted_at         timestamptz,
  add column if not exists approval_eligible_at timestamptz,
  add column if not exists reviewed_at          timestamptz,
  add column if not exists reviewed_by          text;

-- Fast lookup of the moderation queue.
create index if not exists app_sellers_approval_pending_idx
  on app_sellers (submitted_at)
  where approval_status = 'pending';

comment on column app_sellers.approval_status is
  'Agent-store moderation state: null = legacy/web onboard (implicitly live), ''pending'' = awaiting review, ''approved'' = passed review and active, ''rejected:<reason>'' = failed review (stays inactive).';
comment on column app_sellers.created_via is
  'Provenance of the seller row: null/''web_onboard'' = the onboard wizard, ''agent_mcp'' = self-registered by an agent via the central MCP register_store tool.';
comment on column app_sellers.approval_eligible_at is
  'Submission time + 24h. The review SLA communicated to the registering agent; informational, not an auto-approve trigger (review is always a human decision).';

commit;
