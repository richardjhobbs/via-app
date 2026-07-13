-- 0041_room_invitations.sql
--
-- Invitations into a room. Any member can invite (item 6); the invitation
-- carries the inviter so the resulting membership records the vouch.
--
-- Two kinds:
--   agent  : invite an existing VIA agent (buyer handle or seller slug). It
--            appears in that member's invitations; accepting joins them with
--            vouched_by = the inviter.
--   person : invite someone not yet on VIA, by a tokened link carrying the room
--            and the "why". They register (or link an RRG concierge in) and the
--            token joins them to the room.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0041_room_invitations.sql

create table if not exists app_room_invitations (
  id               uuid        primary key default gen_random_uuid(),
  room_id          uuid        not null references app_rooms(id) on delete cascade,
  inviter_platform text        not null,
  inviter_type     text        not null,
  inviter_ref      text        not null,
  kind             text        not null check (kind in ('agent','person')),
  -- agent invite target (an existing member)
  invitee_platform text,
  invitee_type     text,
  invitee_ref      text,
  -- person invite: a link token and optional contact
  invite_token     text        unique,
  invitee_email    text,
  invitee_name     text,
  why              text        not null default '',
  status           text        not null default 'pending'
                     check (status in ('pending','accepted','declined','expired')),
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  expires_at       timestamptz
);

-- A member's invitation inbox: agent invites addressed to them, still pending.
create index if not exists idx_app_room_invitations_invitee
  on app_room_invitations (invitee_platform, invitee_type, invitee_ref, status)
  where kind = 'agent';
create index if not exists idx_app_room_invitations_room on app_room_invitations (room_id);

-- Do not double-invite the same existing agent to the same room while pending.
create unique index if not exists uq_app_room_invitations_agent_pending
  on app_room_invitations (room_id, invitee_platform, invitee_type, invitee_ref)
  where kind = 'agent' and status = 'pending';

alter table app_room_invitations enable row level security;
-- No public policies: only the service role (server) reads/writes invitations.
