-- migrations/0025_pitch_seller_attribution.sql
--
-- Seller attribution on offers. The canonical offer door (POST /api/via/brief/[id]/offer)
-- and the proxy reaction loop both record an offer against a brief. Until now a pitch only
-- carried the calling agent's identity (via_agent_id / ip), so the buyer could not see WHICH
-- seller made the offer. These columns name the seller behind the offer, so the buyer's
-- "Inbound interest" panel shows the store, not an opaque agent id.
--
-- All three are nullable: an external agent pitching with no VIA seller account still records
-- an offer (identity only), and existing rows predate attribution.

alter table app_buyer_brief_pitches
  add column if not exists seller_id   uuid references app_sellers(id) on delete set null,
  add column if not exists seller_slug text,
  add column if not exists seller_name text;

create index if not exists app_buyer_brief_pitches_seller_idx
  on app_buyer_brief_pitches (seller_id);
