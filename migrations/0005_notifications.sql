-- migrations/0005_notifications.sql
--
-- Agent-driven in-app notifications for sellers (Stage 1) and buyers
-- (Stage 2). Surfaced via the dashboard NotificationBell with a 30s
-- polling cadence and the Web Badging API on installed PWAs.
--
-- No transactional email. Rows here are written server-side from per-
-- seller / per-buyer MCP tool handlers (ask_sales_agent, buy_product,
-- get_shipping_quote, etc.) and from the future x402 settlement
-- endpoint. lib/app/notifications.ts wraps inserts.
--
-- Kinds (extensible — keep this list aligned with lib/app/notifications.ts):
--   enquiry   -- a buying agent asked a question or hit a quote tool
--   sale      -- a buy_product call settled
--   transfer  -- a payout tx landed (reserved for x402 settlement)
--   system    -- platform-driven messages (rare)
--
-- All rows are scoped to a single owner_user_id (the Supabase auth
-- user that owns the seller or buyer row). RLS restricts reads + updates
-- to that user; inserts come from the service role.

create table if not exists app_notifications (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('enquiry', 'sale', 'transfer', 'system')),
  title           text not null,
  body            text,
  link            text,                                  -- relative path inside app.getvia.xyz
  metadata        jsonb not null default '{}'::jsonb,    -- e.g. { seller_id, tool_name, agent_identity }
  created_at      timestamptz not null default now(),
  read_at         timestamptz                            -- null = unread
);

create index if not exists app_notifications_owner_unread_idx
  on app_notifications (owner_user_id, created_at desc) where read_at is null;

create index if not exists app_notifications_owner_recent_idx
  on app_notifications (owner_user_id, created_at desc);

alter table app_notifications enable row level security;

-- Users can read their own rows.
drop policy if exists app_notifications_owner_select on app_notifications;
create policy app_notifications_owner_select on app_notifications
  for select using (auth.uid() = owner_user_id);

-- Users can mark their own rows read (or any other update of their own).
drop policy if exists app_notifications_owner_update on app_notifications;
create policy app_notifications_owner_update on app_notifications
  for update using (auth.uid() = owner_user_id)
              with check (auth.uid() = owner_user_id);

-- Users can delete their own rows (clear ledger).
drop policy if exists app_notifications_owner_delete on app_notifications;
create policy app_notifications_owner_delete on app_notifications
  for delete using (auth.uid() = owner_user_id);

-- Inserts only happen via the service-role key (server-only paths). No
-- policy here, which means the anon role cannot insert. Service role
-- bypasses RLS by design.
