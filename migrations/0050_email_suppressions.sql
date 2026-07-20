-- 0050: Email suppression list backing one-click unsubscribe.
--
-- A row here means notification-class email (Back Room digests, room notices,
-- room invitations, agent outreach) is never sent to that address again.
-- Transactional email (receipts, order delivery, pass confirmations) ignores
-- this list. Rows are written by /api/email/unsubscribe and read by sendEmail
-- in lib/app/email.ts. Touched only by the service-role db client, so RLS is
-- enabled with no policies (same as app_push_subscriptions).

create table if not exists app_email_suppressions (
  email      text primary key,
  reason     text not null default 'unsubscribe',
  created_at timestamptz not null default now()
);

alter table app_email_suppressions enable row level security;
