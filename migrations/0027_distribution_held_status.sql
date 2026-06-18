-- Provisional payout hold (NOSTR external-seller capture).
--
-- A sale by a not-yet-approved store (app_sellers.active = false) settles
-- normally (100% of buyer USDC lands in the platform wallet), but the seller's
-- 97.5% payout is HELD instead of released, until a human approves the store
-- (approveAgentStore sets active = true), which then releases the held
-- distributions. This secures the flat 2.5% network fee on deals sourced from
-- the open NOSTR broadcast: an external seller can transact at NOSTR speed but
-- cannot be paid until it is a live VIA seller.
--
-- Add 'held' to the app_distributions status set.

alter table app_distributions drop constraint app_distributions_status_check;
alter table app_distributions add constraint app_distributions_status_check
  check (status in ('pending', 'paid', 'failed', 'held'));
