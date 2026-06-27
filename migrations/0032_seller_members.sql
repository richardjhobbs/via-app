-- 0032_seller_members.sql
--
-- Multi-user seller accounts. Until now each app_sellers row had a single
-- owner_user_id and every admin surface gated on user.id === owner_user_id.
-- This adds a membership table so a seller can have several people with roles,
-- plus a pending-invite table for inviting people who don't have an account yet.
--
-- owner_user_id stays on app_sellers as the immutable billing/wallet owner and
-- the identity the platform-derived agent wallet is keyed to. Access is now
-- decided by app_seller_members; the owner is backfilled as an 'owner' member.

begin;

-- ── Membership ──────────────────────────────────────────────────────────
create table if not exists app_seller_members (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references app_sellers(id) on delete cascade,
  user_id       uuid not null references auth.users(id)  on delete cascade,
  role          text not null check (role in ('owner', 'admin', 'viewer')),
  invited_by    uuid references auth.users(id) on delete set null,
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (seller_id, user_id)
);

create index if not exists app_seller_members_user_id_idx   on app_seller_members (user_id);
create index if not exists app_seller_members_seller_id_idx on app_seller_members (seller_id);

-- ── Pending invites (invitee has no membership yet) ─────────────────────
-- One open invite per (seller, email). Re-inviting overwrites the token + role.
create table if not exists app_seller_invites (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references app_sellers(id) on delete cascade,
  email         text not null,
  role          text not null check (role in ('admin', 'viewer')),
  token         text not null unique,
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  unique (seller_id, email)
);

create index if not exists app_seller_invites_token_idx on app_seller_invites (token);
create index if not exists app_seller_invites_email_idx on app_seller_invites (lower(email));

-- ── Backfill: every existing seller's owner becomes an 'owner' member ────
insert into app_seller_members (seller_id, user_id, role, invited_at, accepted_at)
select s.id, s.owner_user_id, 'owner', s.created_at, s.created_at
from app_sellers s
where s.owner_user_id is not null
on conflict (seller_id, user_id) do nothing;

-- ── RLS (defence in depth; the app queries with the service role) ────────
alter table app_seller_members enable row level security;
alter table app_seller_invites enable row level security;

-- A user can see their own membership rows, and any membership rows of sellers
-- they belong to (so the team list works under an anon/auth client too).
create policy "seller_members_self_select" on app_seller_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from app_seller_members m2
               where m2.seller_id = app_seller_members.seller_id
                 and m2.user_id = auth.uid())
  );

-- Invites are readable by admins/owners of the seller.
create policy "seller_invites_admin_select" on app_seller_invites
  for select using (
    exists (select 1 from app_seller_members m
            where m.seller_id = app_seller_invites.seller_id
              and m.user_id = auth.uid()
              and m.role in ('owner', 'admin'))
  );

commit;
