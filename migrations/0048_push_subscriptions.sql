-- 0048: Web push subscriptions for the Back Room PWA.
--
-- One row per browser push endpoint, keyed to a member triple (matching 0047's
-- member_platform/member_type/member_ref convention). endpoint is the browser's
-- push-service URL and is globally unique. Dead endpoints (404/410 on send) are
-- pruned by the sender (lib/app/backroom/push.ts). Touched only by the
-- service-role db client, so no RLS (same as app_room_member_prefs).

create table if not exists app_push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  member_platform text not null,
  member_type     text not null,
  member_ref      text not null,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  created_at      timestamptz not null default now(),
  last_ok_at      timestamptz
);

create index if not exists app_push_subscriptions_member_idx
  on app_push_subscriptions (member_platform, member_type, member_ref);

-- All access is via the service-role db client, which bypasses RLS. Enabling it
-- with no policies blocks the anon/publishable key from reading or deleting
-- these push endpoint credentials.
alter table app_push_subscriptions enable row level security;
