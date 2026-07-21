-- 0051: importing an RRG concierge claims its federated Back Room identity.
--
-- The whole point of "Bring my concierge to VIA" is that the VIA buyer IS the
-- same agent. Before this, the federated identity (rrg/buyer/<name>) kept its
-- own rooms, invitations, taste and events, invisible to the owner's VIA
-- session. app_claim_rrg_member re-keys everything that identity accumulated
-- onto the VIA identity (via/buyer/<handle>). Idempotent; where the VIA
-- identity already holds an equivalent row the federated leftover is dropped
-- (seats, prefs, pending invites, introductions) or left inert (taste card).

create or replace function app_claim_rrg_member(p_rrg_ref text, p_via_ref text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Room seats: move unless the VIA identity is already seated in that room.
  update app_room_members m
     set member_platform = 'via', member_ref = p_via_ref
   where m.member_platform = 'rrg' and m.member_type = 'buyer' and lower(m.member_ref) = lower(p_rrg_ref)
     and not exists (
       select 1 from app_room_members v
        where v.room_id = m.room_id and v.member_platform = 'via' and v.member_type = 'buyer'
          and lower(v.member_ref) = lower(p_via_ref));
  delete from app_room_members
   where member_platform = 'rrg' and member_type = 'buyer' and lower(member_ref) = lower(p_rrg_ref);

  -- Notification prefs (pkey is the member triplet).
  update app_room_member_prefs m
     set member_platform = 'via', member_ref = p_via_ref
   where m.member_platform = 'rrg' and m.member_type = 'buyer' and lower(m.member_ref) = lower(p_rrg_ref)
     and not exists (
       select 1 from app_room_member_prefs v
        where v.member_platform = 'via' and v.member_type = 'buyer' and lower(v.member_ref) = lower(p_via_ref));
  delete from app_room_member_prefs
   where member_platform = 'rrg' and member_type = 'buyer' and lower(member_ref) = lower(p_rrg_ref);

  -- Invitations addressed to the identity. Only pending agent invites carry a
  -- partial unique (room + invitee); history moves unconditionally.
  update app_room_invitations i
     set invitee_platform = 'via', invitee_ref = p_via_ref
   where i.invitee_platform = 'rrg' and i.invitee_type = 'buyer' and lower(i.invitee_ref) = lower(p_rrg_ref)
     and not (i.kind = 'agent' and i.status = 'pending' and exists (
       select 1 from app_room_invitations v
        where v.room_id = i.room_id and v.kind = 'agent' and v.status = 'pending'
          and v.invitee_platform = 'via' and v.invitee_type = 'buyer' and v.invitee_ref = p_via_ref));
  delete from app_room_invitations
   where invitee_platform = 'rrg' and invitee_type = 'buyer' and lower(invitee_ref) = lower(p_rrg_ref)
     and kind = 'agent' and status = 'pending';

  -- Invitations sent by the identity.
  update app_room_invitations
     set inviter_platform = 'via', inviter_ref = p_via_ref
   where inviter_platform = 'rrg' and inviter_type = 'buyer' and lower(inviter_ref) = lower(p_rrg_ref);

  -- Authored history and holdings with no member-unique constraints.
  update app_room_events set author_platform = 'via', author_ref = p_via_ref
   where author_platform = 'rrg' and author_type = 'buyer' and lower(author_ref) = lower(p_rrg_ref);
  update app_push_subscriptions set member_platform = 'via', member_ref = p_via_ref
   where member_platform = 'rrg' and member_type = 'buyer' and lower(member_ref) = lower(p_rrg_ref);
  update app_product_cocreators set member_platform = 'via', member_ref = p_via_ref
   where member_platform = 'rrg' and member_type = 'buyer' and lower(member_ref) = lower(p_rrg_ref);
  update app_taste_matches set a_platform = 'via', a_ref = p_via_ref
   where a_platform = 'rrg' and a_type = 'buyer' and lower(a_ref) = lower(p_rrg_ref);
  update app_taste_matches set b_platform = 'via', b_ref = p_via_ref
   where b_platform = 'rrg' and b_type = 'buyer' and lower(b_ref) = lower(p_rrg_ref);

  -- Introductions (unique pair): move each side unless the VIA pair exists.
  update app_introductions i
     set a_platform = 'via', a_ref = p_via_ref
   where i.a_platform = 'rrg' and i.a_type = 'buyer' and lower(i.a_ref) = lower(p_rrg_ref)
     and not exists (
       select 1 from app_introductions v
        where v.a_platform = 'via' and v.a_type = 'buyer' and v.a_ref = p_via_ref
          and v.b_platform = i.b_platform and v.b_type = i.b_type and v.b_ref = i.b_ref);
  delete from app_introductions
   where a_platform = 'rrg' and a_type = 'buyer' and lower(a_ref) = lower(p_rrg_ref);
  update app_introductions i
     set b_platform = 'via', b_ref = p_via_ref
   where i.b_platform = 'rrg' and i.b_type = 'buyer' and lower(i.b_ref) = lower(p_rrg_ref)
     and not exists (
       select 1 from app_introductions v
        where v.b_platform = 'via' and v.b_type = 'buyer' and v.b_ref = p_via_ref
          and v.a_platform = i.a_platform and v.a_type = i.a_type and v.a_ref = i.a_ref);
  delete from app_introductions
   where b_platform = 'rrg' and b_type = 'buyer' and lower(b_ref) = lower(p_rrg_ref);

  -- Taste card (one per member): move it if the VIA identity has none; an
  -- existing VIA card wins and the federated card stays published but inert.
  update app_taste_cards c
     set member_platform = 'via', member_ref = p_via_ref
   where c.member_platform = 'rrg' and c.member_type = 'buyer' and lower(c.member_ref) = lower(p_rrg_ref)
     and not exists (
       select 1 from app_taste_cards v
        where v.member_platform = 'via' and v.member_type = 'buyer' and v.member_ref = p_via_ref);

  -- Taste profiles: the active flag carries a partial unique, so a federated
  -- active profile yields to an existing VIA active one before moving.
  update app_taste_profiles p
     set is_active = false
   where p.member_platform = 'rrg' and p.member_type = 'buyer' and lower(p.member_ref) = lower(p_rrg_ref)
     and p.is_active
     and exists (
       select 1 from app_taste_profiles v
        where v.member_platform = 'via' and v.member_type = 'buyer' and v.member_ref = p_via_ref and v.is_active);
  update app_taste_profiles
     set member_platform = 'via', member_ref = p_via_ref
   where member_platform = 'rrg' and member_type = 'buyer' and lower(member_ref) = lower(p_rrg_ref);
end;
$$;
